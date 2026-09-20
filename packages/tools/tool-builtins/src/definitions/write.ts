/**
 * @file tools/write
 * @description Builtin write tool: creates or overwrites a workspace file.
 *
 * Responsibilities:
 * - Declare the tool's JSON schema
 * - Create or overwrite files within the workspace
 */

import type { ToolArgs, ToolDefinition, ToolExecutionResult, ToolWorkspace } from "@agentprism/contracts";
import { estimateTokensFromChars } from "@agentprism/contracts";
import { WorkspaceError } from "@agentprism/environment";
import { MAX_FILE } from "./caps.js";
import { toolTuningValue } from "../tuning.js";
import { asWorkspaceView } from "./workspace-view.js";

export const WRITE_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    path: { type: "string" },
    content: { type: "string" },
  },
  required: ["path", "content"],
  additionalProperties: false,
};

async function executeWrite(workspace: ToolWorkspace, args: ToolArgs): Promise<ToolExecutionResult> {
  try {
    const view = asWorkspaceView(workspace);
    const filePath = String(args.path ?? "");
    const content = String(args.content ?? "");
    // Refuse instead of silently truncating: a truncated write reported as ok would lose data while the model believes it succeeded.
    const maxFile = toolTuningValue("maxFileChars", MAX_FILE);
    if (content.length > maxFile) {
      return {
        result: `Error: content is ${content.length} chars, exceeding the ${maxFile}-char single-write cap; split it into smaller writes or appends`,
        fileDiff: null,
        ok: false,
        code: "workspace_error",
      };
    }
    const canonical = view.fs.canonicalize(filePath);
    const existed = canonical !== null && view.fs.exists(filePath);
    const message = view.fs.writeFile(filePath, content);
    const diff = `${existed ? "Modified" : "Created"} ${filePath} (~${estimateTokensFromChars(content.length)} tokens)`;
    return { result: message, fileDiff: diff, ok: true };
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return { result: error.message, fileDiff: null, ok: false, code: "workspace_error" };
    }
    throw error;
  }
}

/** Builtin write tool definition. */
export const writeTool: ToolDefinition = {
  name: "write",
  description: "Write or overwrite a file in the workspace.",
  jsonSchema: WRITE_JSON_SCHEMA,
  mutatesWorkspace: true,
  execute: executeWrite,
};
