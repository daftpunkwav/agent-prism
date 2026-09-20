/**
 * @file tools/edit
 * @description Builtin edit tool: exact substring replace inside a workspace file.
 *
 * Responsibilities:
 * - Declare the tool's JSON schema
 * - Perform exact substring replacement (first occurrence only) within the workspace
 */

import type { ToolArgs, ToolDefinition, ToolExecutionResult, ToolWorkspace } from "@agentprism/contracts";
import { WorkspaceError } from "@agentprism/environment";
import { MAX_FILE } from "./caps.js";
import { toolTuningValue } from "../tuning.js";
import { asWorkspaceView } from "./workspace-view.js";

export const EDIT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    path: { type: "string" },
    old_text: { type: "string" },
    new_text: { type: "string" },
  },
  required: ["path", "old_text", "new_text"],
  additionalProperties: false,
};

async function executeEdit(workspace: ToolWorkspace, args: ToolArgs): Promise<ToolExecutionResult> {
  try {
    const view = asWorkspaceView(workspace);
    const filePath = String(args.path ?? "");
    const oldText = String(args.old_text ?? "");
    const newText = String(args.new_text ?? "");
    // Refuse instead of silently truncating (same policy as write): a truncated replacement reported as ok would corrupt the file while the model believes it succeeded.
    const maxFile = toolTuningValue("maxFileChars", MAX_FILE);
    if (newText.length > maxFile) {
      return {
        result: `Error: new_text is ${newText.length} chars, exceeding the ${maxFile}-char single-edit cap; split it into smaller edits`,
        fileDiff: null,
        ok: false,
        code: "workspace_error",
      };
    }
    const message = view.fs.editFile(filePath, oldText, newText);
    return { result: message, fileDiff: `Edited ${filePath}`, ok: true };
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return { result: error.message, fileDiff: null, ok: false, code: "workspace_error" };
    }
    throw error;
  }
}

/** Builtin edit tool definition. */
export const editTool: ToolDefinition = {
  name: "edit",
  description: "Exact substring replace in a file (old_text must match exactly).",
  jsonSchema: EDIT_JSON_SCHEMA,
  mutatesWorkspace: true,
  execute: executeEdit,
};
