/**
 * @file tools/grep
 * @description Builtin grep tool: search workspace file contents by regex.
 *
 * Responsibilities:
 * - Declare the tool's JSON schema
 * - Walk workspace files and return `path:line: text` matches
 *
 * Pure TypeScript regex over the scoped filesystem walker: search needs no
 * external binary.
 */

import type { ToolArgs, ToolDefinition, ToolExecutionResult, ToolWorkspace } from "@agentprism/contracts";
import { WorkspaceError } from "@agentprism/environment";

import { boundText } from "./spill.js";
import { globToRegExp } from "./glob.js";
import { asWorkspaceView } from "./workspace-view.js";

export const GREP_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    pattern: { type: "string", description: "Regular expression to search for" },
    path: { type: "string", description: "Optional subdirectory to search in" },
    glob: { type: "string", description: "Optional glob filter for file names, e.g. *.py" },
    case_insensitive: { type: "boolean" },
  },
  required: ["pattern"],
  additionalProperties: false,
};

/** Maximum matched lines returned before truncation kicks in. */
const MAX_MATCH_LINES = 200;

/** Per-file byte cap: larger files are searched only through their head. */
const MAX_GREP_FILE_BYTES = 2 * 1024 * 1024;
/** Total bytes scanned per call; the walk stops (loudly) once it is spent. */
const MAX_GREP_TOTAL_BYTES = 32 * 1024 * 1024;

/**
 * Conservative pre-screen for catastrophic-backtracking regex shapes: an
 * UNBOUNDED quantifier (`*`, `+`, `{n,}`) applied to a group whose body carries
 * another quantifier can backtrack exponentially (`(a+)+`, `(\\d{1,3})*$`),
 * and adjacent quantifiers (`a++`) repeat the same hazard. A bounded outer
 * quantifier (`{n,m}`) keeps the search tree finite and passes. Heuristic by
 * design — exotic alternation-overlap bombs are not caught — but the common
 * model-emitted forms are rejected before they can pin the event loop
 * (regex.test is synchronous; no timeout can interrupt it).
 */
export function hasNestedQuantifier(pattern: string): boolean {
  /** Per open group: does its body contain a quantifier? */
  const groupStack: boolean[] = [];
  let bodyHasQuantifier = false;
  let index = 0;
  const quantifierSpec = (start: number): { spec: string; end: number } | null => {
    const close = pattern.indexOf("}", start);
    if (close === -1) return null;
    const spec = pattern.slice(start + 1, close);
    return /^\d+(,\d*)?$/.test(spec) ? { spec, end: close } : null;
  };
  while (index < pattern.length) {
    const char = pattern[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "[") {
      // Character class: quantifier characters inside are literals.
      index += 1;
      if (pattern[index] === "^") index += 1;
      if (pattern[index] === "]") index += 1;
      while (index < pattern.length && pattern[index] !== "]") {
        if (pattern[index] === "\\") index += 1;
        index += 1;
      }
      index += 1;
      continue;
    }
    if (char === "(") {
      groupStack.push(bodyHasQuantifier);
      bodyHasQuantifier = false;
      index += 1;
      continue;
    }
    if (char === ")") {
      index += 1;
      const bodyHad: boolean = bodyHasQuantifier;
      if (bodyHad) {
        // Unbounded quantifier directly over a group whose body carries a
        // quantifier: the exponential shape. Bounded {n,m} passes.
        const next = pattern[index];
        if (next === "*" || next === "+") return true;
        if (next === "{") {
          const spec = quantifierSpec(index);
          if (spec !== null && spec.spec.endsWith(",")) return true;
        }
      }
      // A group whose subtree carried a quantifier makes the enclosing body
      // quantifier-bearing too (e.g. ((a?)b)* must flag).
      bodyHasQuantifier = bodyHad || (groupStack.pop() ?? false);
      continue;
    }
    if (char === "*" || char === "+") {
      bodyHasQuantifier = true;
      index += 1;
      continue;
    }
    if (char === "{") {
      const spec = quantifierSpec(index);
      if (spec !== null) {
        bodyHasQuantifier = true;
        index = spec.end + 1;
        continue;
      }
      index += 1;
      continue;
    }
    index += 1;
  }
  return false;
}

async function executeGrep(workspace: ToolWorkspace, args: ToolArgs): Promise<ToolExecutionResult> {
  try {
    const view = asWorkspaceView(workspace);
    const pattern = String(args.pattern ?? "");
    if (pattern === "") {
      return { result: "Error: pattern must not be empty", fileDiff: null, ok: false, code: "workspace_error" };
    }
    if (hasNestedQuantifier(pattern)) {
      // Rejected before compile: regex.test below is synchronous, so a
      // catastrophic-backtracking pattern would freeze the whole server, not
      // just this tool call (no timeout can interrupt a running RegExp).
      return {
        result: `Error: pattern rejected: nested quantifier risks exponential backtracking; rewrite with a bounded group (e.g. {1,3}): ${pattern}`,
        fileDiff: null,
        ok: false,
        code: "workspace_error",
      };
    }
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, args.case_insensitive === true ? "i" : "");
    } catch {
      return { result: `Error: invalid regular expression: ${pattern}`, fileDiff: null, ok: false, code: "workspace_error" };
    }
    const basePath = String(args.path ?? "");
    const globFilter = String(args.glob ?? "").trim();
    // Same invalid-pattern reporting as the glob tool (a SyntaxError here must not escape as an exception).
    let globMatcher: RegExp | null = null;
    if (globFilter !== "") {
      try {
        globMatcher = globToRegExp(globFilter);
      } catch {
        return { result: `Error: invalid glob pattern: ${globFilter}`, fileDiff: null, ok: false, code: "workspace_error" };
      }
    }
    const files = view.fs.listFiles(basePath, { recursive: true });
    const lines: string[] = [];
    let truncated = false;
    // Byte budgets keep one call from pinning the event loop on a dependency tree:
    // a giant file is searched through its head only, and the walk stops once the
    // total budget is spent. Both cases are reported instead of silently dropping.
    let bytesLeft = MAX_GREP_TOTAL_BYTES;
    let headOnlyFiles = 0;
    for (const file of files) {
      if (globMatcher !== null) {
        // ripgrep semantics: a pattern without "/" matches the file name, otherwise the path
        const subject = globFilter.includes("/") ? file : file.split("/").pop() ?? file;
        if (!globMatcher.test(subject)) continue;
      }
      if (bytesLeft <= 0) {
        truncated = true;
        break;
      }
      let content: string;
      try {
        const head = view.fs.readFileHead(file, Math.min(MAX_GREP_FILE_BYTES, bytesLeft));
        content = head.text;
        bytesLeft -= content.length;
        if (head.truncated) headOnlyFiles += 1;
      } catch {
        // Files that vanish or become unreadable mid-walk are skipped; no binary detection (binary files are searched as UTF-8).
        continue;
      }
      const fileLines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
      for (let i = 0; i < fileLines.length; i += 1) {
        // Test window: regex backtracking on megabyte single-line files (minified bundles)
        // can pin the event loop; matches past the window can be missed (same best-effort
        // trade-off as the judging regex cap).
        const lineText = (fileLines[i] ?? "").slice(0, 20_000);
        if (!regex.test(lineText)) continue;
        if (lines.length >= MAX_MATCH_LINES) {
          truncated = true;
          break;
        }
        lines.push(`${file}:${i + 1}: ${(fileLines[i] ?? "").slice(0, 400)}`);
      }
      if (truncated) break;
    }
    const suffixes: string[] = [];
    if (truncated) suffixes.push(`(results truncated at ${MAX_MATCH_LINES} lines)`);
    if (headOnlyFiles > 0) suffixes.push(`${headOnlyFiles} file(s) larger than ${MAX_GREP_FILE_BYTES} bytes were searched only in their first ${MAX_GREP_FILE_BYTES} bytes`);
    if (lines.length === 0) {
      // "No matches" must not read as a verdict on the whole workspace when the walk
      // stopped early or only part of some files was searched.
      const qualifier = suffixes.length === 0 ? "" : ` (${suffixes.join("; ")})`;
      return { result: `No matches for ${pattern}${qualifier}`, fileDiff: null, ok: true };
    }
    const suffix = suffixes.length === 0 ? "" : `\n…(${suffixes.join("; ")})`;
    return { result: boundText(workspace, "grep", lines.join("\n") + suffix), fileDiff: null, ok: true };
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return { result: error.message, fileDiff: null, ok: false, code: "workspace_error" };
    }
    throw error;
  }
}

/** Builtin grep tool definition. */
export const grepTool: ToolDefinition = {
  name: "grep",
  description: "Search file contents in the workspace with a regular expression.",
  jsonSchema: GREP_JSON_SCHEMA,
  mutatesWorkspace: false,
  execute: executeGrep,
};
