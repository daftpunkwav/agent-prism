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
 * Upper bound on unbounded quantifier groups in the compiled pattern: the
 * "any run" group (from a bare double star) and the "zero or more path
 * segments" group (from a double star followed by a slash). Separated
 * cross-segment stars make the backtracker explore every split of the
 * subject: measured V8 cost is ~0.5s per path at four groups on a
 * 300-character path and ~7s at six on 120 characters, so a crafted pattern
 * could pin the tool for minutes per file. Legitimate globs stay far below
 * the cap because a single star compiles to the linear "any run except
 * separator" class.
 */
export const GLOB_MAX_UNBOUNDED_GROUPS = 3;

/**
 * Compiles a glob pattern into a regex. Supported syntax: `**` (any depth),
 * `*` (any run except `/`), `?` (single char except `/`), `[abc]` classes,
 * and `{a,b}` alternation. Everything else is literal.
 *
 * Adjacent unbounded groups are collapsed to one — a bare double star, two
 * adjacent double stars, or a double star plus a slash all match the same
 * strings — and the total is capped at {@link GLOB_MAX_UNBOUNDED_GROUPS};
 * exceeding the cap throws before compilation so a hostile pattern fails as a
 * tool error instead of as a backtracking hang.
 */
export function globToRegExp(pattern: string): RegExp {
  let regex = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i] ?? "";
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // `**/` matches zero or more path segments; a bare trailing `**` matches everything
        if (pattern[i + 2] === "/") {
          regex += "(?:.*/)?";
          i += 2;
        } else {
          regex += ".*";
          i += 1;
        }
      } else {
        regex += "[^/]*";
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
  const unbounded = regex.match(/\.\*|\(\?:\.\*\/\)\?/g)?.length ?? 0;
  if (unbounded > GLOB_MAX_UNBOUNDED_GROUPS) {
    throw new RangeError(`glob pattern too complex (${unbounded} wildcard runs, max ${GLOB_MAX_UNBOUNDED_GROUPS})`);
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
