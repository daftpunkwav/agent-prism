/**
 * @file tools/glob
 * @description Builtin glob tool: find workspace files by a glob pattern.
 *
 * Responsibilities:
 * - Declare the tool's JSON schema
 * - Match workspace files against a glob pattern over the scoped filesystem walker
 */

import type { ToolArgs, ToolDefinition, ToolExecutionResult, ToolWorkspace } from "@agentprism/contracts";
import { WorkspaceError } from "@agentprism/environment";

import { boundText } from "./spill.js";
import { asWorkspaceView } from "./workspace-view.js";

export const GLOB_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    pattern: { type: "string", description: "Glob pattern, e.g. **/*.py or src/*.ts" },
    path: { type: "string", description: "Optional subdirectory to search in" },
  },
  required: ["pattern"],
  additionalProperties: false,
};

/**
 * Upper bound on quantified wildcard groups the compiler tolerates, counted
 * two ways during the build: `unbounded` (cross-segment groups — "any run"
 * from a bare double star, "zero or more segments" from a double star plus
 * slash) and `segmentRuns` (consecutive quantified groups without an
 * intervening literal separator). The second counter exists because overlap,
 * not unboundedness, drives backtracking: `a*a*a*` compiles to overlapping
 * "run except separator" groups whose backtrack tree grows like
 * C(subject length, group count). Measured V8 cost is ~0.5s per path at four
 * groups on a 300-character path and ~7s at six on 120 characters, so the
 * caps reject a hostile pattern before compilation instead of pinning the
 * tool for minutes per file. Legitimate globs stay far below both caps: one
 * star is one group, and a literal slash starts a fresh run.
 */
export const GLOB_MAX_UNBOUNDED_GROUPS = 3;

/**
 * Compiles a glob pattern into a regex. Supported syntax: `**` (any depth),
 * `*` (any run except `/`), `?` (single char except `/`), `[abc]` classes,
 * and `{a,b}` alternation. Everything else is literal.
 *
 * During the build the wildcard counters of {@link GLOB_MAX_UNBOUNDED_GROUPS}
 * are charged per group and throw as soon as a cap is exceeded, so a hostile
 * pattern fails as a tool error instead of as a backtracking hang. After the
 * build, adjacent groups that are mutually subsuming are collapsed to one:
 * two adjacent "any run" groups, two adjacent "zero or more segments" groups,
 * and either of them followed by or preceded by an "any run" group each match
 * exactly what their single-group form matches. A standalone "double star
 * plus slash" is not subsumed — it can only match strings whose wildcard
 * portion ends in a separator — so it survives a collapse with no adjacent
 * group to absorb it.
 */
export function globToRegExp(pattern: string): RegExp {
  let regex = "";
  let unbounded = 0;
  let segmentRuns = 0;
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i] ?? "";
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // `**/` matches zero or more path segments; a bare trailing `**` matches everything
        if (pattern[i + 2] === "/") {
          regex += "(?:.*/)?";
          unbounded += 1;
          i += 2;
        } else {
          regex += ".*";
          unbounded += 1;
          i += 1;
        }
        segmentRuns += 1;
      } else {
        regex += "[^/]*";
        segmentRuns += 1;
      }
      if (unbounded > GLOB_MAX_UNBOUNDED_GROUPS || segmentRuns > GLOB_MAX_UNBOUNDED_GROUPS) {
        throw new RangeError(
          `glob pattern too complex (${Math.max(unbounded, segmentRuns)} wildcard runs, max ${GLOB_MAX_UNBOUNDED_GROUPS})`,
        );
      }
    } else if (ch === "?") {
      regex += "[^/]";
    } else if (ch === "[") {
      const end = pattern.indexOf("]", i + 1);
      if (end === -1) {
        regex += "\\[";
        continue;
      }
      regex += pattern.slice(i, end + 1);
      i = end;
    } else if (ch === "{") {
      const end = pattern.indexOf("}", i + 1);
      if (end === -1) {
        regex += "\\{";
        continue;
      }
      const parts = pattern.slice(i + 1, end).split(",");
      regex += `(?:${parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`;
      i = end;
    } else {
      // A literal separator ends the current run of adjacent quantified groups.
      if (ch === "/") segmentRuns = 0;
      regex += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  // Collapse to a fixpoint: merging one pair can create a new adjacency
  // (`.*(?:.*/)?.*` → `.*.*` → `.*`), and every rule strictly shortens the
  // string, so the loop runs at most a few times.
  let previous = "";
  while (regex !== previous) {
    previous = regex;
    regex = regex
      .replaceAll(".*.*", ".*")
      .replaceAll("(?:.*/)?(?:.*/)?", "(?:.*/)?")
      .replaceAll(".*(?:.*/)?", ".*")
      .replaceAll("(?:.*/)?.*", ".*");
  }
  return new RegExp(`^${regex}$`);
}

async function executeGlob(workspace: ToolWorkspace, args: ToolArgs): Promise<ToolExecutionResult> {
  try {
    const view = asWorkspaceView(workspace);
    const pattern = String(args.pattern ?? "").trim();
    if (pattern === "") {
      return { result: "Error: pattern must not be empty", fileDiff: null, ok: false, code: "workspace_error" };
    }
    const basePath = String(args.path ?? "");
    // A malformed character class (e.g. [z-a]) makes new RegExp throw SyntaxError,
    // and a wildcard run above GLOB_MAX_UNBOUNDED_GROUPS throws RangeError; report
    // both as tool errors like grep does for invalid regexes instead of escaping
    // as an exception.
    let matcher: RegExp;
    try {
      matcher = globToRegExp(pattern);
    } catch (error) {
      const detail = error instanceof RangeError ? error.message : `invalid glob pattern: ${pattern}`;
      return { result: `Error: ${detail}`, fileDiff: null, ok: false, code: "workspace_error" };
    }
    // Linear trailing-slash trim: `\/+$` backtracking degrades quadratically on
    // a long slash run that is not at the string end.
    let base = basePath;
    while (base.endsWith("/")) base = base.slice(0, -1);
    const basePrefix = base === "" ? "" : `${base}/`;
    const files = view.fs.listFiles(basePath, { recursive: true }).filter((file) => matcher.test(file) || matcher.test(`${basePrefix}${file}`));
    if (files.length === 0) {
      return { result: `No files match ${pattern}`, fileDiff: null, ok: true };
    }
    return { result: boundText(workspace, "glob", files.join("\n")), fileDiff: null, ok: true };
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return { result: error.message, fileDiff: null, ok: false, code: "workspace_error" };
    }
    throw error;
  }
}

/** Builtin glob tool definition. */
export const globTool: ToolDefinition = {
  name: "glob",
  description: "Find workspace files by glob pattern (e.g. **/*.py).",
  jsonSchema: GLOB_JSON_SCHEMA,
  mutatesWorkspace: false,
  execute: executeGlob,
};
