/**
 * @file tools/grep
 * @description Builtin grep tool: search workspace file contents by regex.
 *
 * Responsibilities:
 * - Declare the tool's JSON schema
 * - Walk workspace files and return `path:line: text` matches
 *
 * Project-ized from opencode's grep tool semantics (ripgrep there, pure TS
 * regex over the scoped filesystem walker here) so no external binary is needed.
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

async function executeGrep(workspace: ToolWorkspace, args: ToolArgs): Promise<ToolExecutionResult> {
  try {
    const view = asWorkspaceView(workspace);
    const pattern = String(args.pattern ?? "");
    if (pattern === "") {
      return { result: "Error: pattern must not be empty", fileDiff: null, ok: false, code: "workspace_error" };
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
    for (const file of files) {
      if (globMatcher !== null) {
        // ripgrep semantics: a pattern without "/" matches the file name, otherwise the path
        const subject = globFilter.includes("/") ? file : file.split("/").pop() ?? file;
        if (!globMatcher.test(subject)) continue;
      }
      let content: string;
      try {
        content = view.fs.readFile(file);
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
    if (lines.length === 0) {
      return { result: `No matches for ${pattern}`, fileDiff: null, ok: true };
    }
    const suffix = truncated ? `\n…(results truncated at ${MAX_MATCH_LINES} lines)` : "";
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
