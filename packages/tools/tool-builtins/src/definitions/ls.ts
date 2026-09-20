/**
 * @file tools/ls
 * @description Builtin ls tool: directory entries or the workspace file tree.
 *
 * Responsibilities:
 * - Declare the tool's JSON schema
 * - List directory entries within the workspace
 */

import type { ToolArgs, ToolDefinition, ToolExecutionResult, ToolWorkspace } from "@agentprism/contracts";
import { WorkspaceError } from "@agentprism/environment";
import { asWorkspaceView } from "./workspace-view.js";
import { boundText } from "./spill.js";

export const LS_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    path: { type: "string" },
    recursive: { type: "boolean" },
  },
  additionalProperties: false,
};

async function executeLs(workspace: ToolWorkspace, args: ToolArgs): Promise<ToolExecutionResult> {
  try {
    const view = asWorkspaceView(workspace);
    const dirPath = String(args.path ?? "");
    const recursive = Boolean(args.recursive);
    if (dirPath === "" && recursive) {
      return { result: boundText(workspace, "ls", view.fs.fileTree(view.name)), fileDiff: null, ok: true };
    }
    const files = view.fs.listFiles(dirPath, { recursive });
    return { result: files.length > 0 ? boundText(workspace, "ls", files.join("\n")) : "(empty)", fileDiff: null, ok: true };
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return { result: error.message, fileDiff: null, ok: false, code: "workspace_error" };
    }
    throw error;
  }
}

/** Builtin ls tool definition. */
export const lsTool: ToolDefinition = {
  name: "ls",
  description: "List directory contents or the full workspace file tree.",
  jsonSchema: LS_JSON_SCHEMA,
  mutatesWorkspace: false,
  execute: executeLs,
};
