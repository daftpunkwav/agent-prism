/**
 * @file tools/read
 * @description Builtin read tool: file contents with optional offset/limit.
 *
 * Responsibilities:
 * - Declare the tool's JSON schema
 * - Return file contents bounded by offset/limit (offset is 1-based)
 */

import type { ToolArgs, ToolDefinition, ToolExecutionResult, ToolWorkspace } from "@agentprism/contracts";
import { WorkspaceError } from "@agentprism/environment";
import { MAX_FILE, readInt, truncate } from "./caps.js";
import { toolTuningValue } from "../tuning.js";
import { asWorkspaceView } from "./workspace-view.js";

export const READ_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    path: { type: "string" },
    offset: { type: "integer" },
    limit: { type: "integer" },
  },
  required: ["path"],
  additionalProperties: false,
};

async function executeRead(workspace: ToolWorkspace, args: ToolArgs): Promise<ToolExecutionResult> {
  try {
    const view = asWorkspaceView(workspace);
    const filePath = String(args.path ?? "");
    const cap = toolTuningValue("maxFileChars", MAX_FILE);
    // Read a bounded head instead of the whole file: an oversized asset used to be
    // fully materialized (and split into lines) before any cap applied. Four bytes
    // per character is the UTF-8 upper bound, so the byte cap cannot cut text the
    // char cap wants to keep.
    const head = view.fs.readFileHead(filePath, cap * 4);
    const offset = readInt(args, "offset", 0);
    const limit = readInt(args, "limit", 0);
    let lines = head.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    if (offset > 0) lines = lines.slice(offset - 1);
    if (limit > 0) lines = lines.slice(0, limit);
    const joined = lines.join("\n");
    // Loud, not silent: the model must know it is looking at a prefix — and the note
    // stays inside the same cap, so a tiny cap keeps the old bounded shape.
    const note = "\n…(file longer: read with offset/limit for the rest)";
    const capped = head.truncated || joined.length > cap;
    const result = capped && cap > note.length ? `${truncate(joined, cap - note.length)}${note}` : truncate(joined, cap);
    return { result, fileDiff: null, ok: true };
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return { result: error.message, fileDiff: null, ok: false, code: "workspace_error" };
    }
    throw error;
  }
}

/** Builtin read tool definition. */
export const readTool: ToolDefinition = {
  name: "read",
  description: "Read file contents from the workspace.",
  jsonSchema: READ_JSON_SCHEMA,
  mutatesWorkspace: false,
  execute: executeRead,
};
