/**
 * @file tools/glob
 * @description Builtin glob tool: find workspace files by a glob pattern.
 *
 * Responsibilities:
 * - Declare the tool's JSON schema
 * - Match workspace files against a glob pattern (project-ized from opencode's
 *   glob tool semantics; implemented over the scoped filesystem walker)
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
 * Compiles a glob pattern into a regex. Supported syntax: `**` (any depth),
 * `*` (any run except `/`), `?` (single char except `/`), `[abc]` classes,
 * and `{a,b}` alternation. Everything else is literal.
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
    // A malformed character class (e.g. [z-a]) makes new RegExp throw SyntaxError;
    // report it as a tool error like grep does for invalid regexes instead of escaping as an exception.
    let matcher: RegExp;
    try {
      matcher = globToRegExp(pattern);
    } catch {
      return { result: `Error: invalid glob pattern: ${pattern}`, fileDiff: null, ok: false, code: "workspace_error" };
    }
    const basePrefix = basePath === "" ? "" : `${basePath.replace(/\/+$/, "")}/`;
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
