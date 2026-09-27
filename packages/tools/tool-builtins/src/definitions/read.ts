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

/** Bytes read per scan window when an offset forces line counting. */
const READ_WINDOW_BYTES = 256 * 1024;
/**
 * How far a read may scan to reach an offset. Beyond this the file is treated as
 * unaddressable and the model is told so: reading the whole file to honour an offset
 * would undo the point of bounded reads.
 */
const READ_SCAN_BUDGET_BYTES = 8 * 1024 * 1024;

/** Normalizes line endings once, for both the plain and the windowed path. */
function toLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

/**
 * Reads the window that starts at `offset` (1-based line). The file is scanned in
 * bounded windows counting lines, so an offset deep into a large file stays cheap and
 * a file longer than the scan budget is reported instead of silently truncated.
 */
function readFromOffset(
  fs: {
    readFileHead(path: string, maxBytes: number, startByte?: number): { text: string; truncated: boolean; bytesRead: number };
  },
  filePath: string,
  offset: number,
  limit: number,
  cap: number,
): { text: string; moreContent: boolean; beyondScan: boolean } {
  // The scan stops once it has enough output: the model asked for at most `limit`
  // lines and the result is capped anyway.
  const enough = (collected: string): boolean => collected.length >= cap * 4;
  let position = 0;
  let linesToSkip = Math.max(0, offset - 1);
  let collected = "";
  let moreContent = false;
  let linesCollected = 0;
  for (;;) {
    const window = fs.readFileHead(filePath, READ_WINDOW_BYTES, position);
    // Advance by the bytes the window consumed: the decoded text can be shorter when a
    // character was cut at the cap, and advancing by the text would re-read a fragment.
    position += window.bytesRead;
    moreContent = window.truncated;
    const lines = toLines(window.text);
    // A window that stops mid-line ends with a fragment: it is not a line until the
    // next window's head merges with it, so it must not be counted (the merge's own
    // count covers the completed line exactly once).
    const endsMidLine = window.truncated && !window.text.endsWith("\n");
    if (linesToSkip > 0) {
      if (lines.length - 1 < linesToSkip) {
        linesToSkip -= lines.length - 1;
      } else {
        const skipped = linesToSkip;
        collected = lines.slice(skipped).join("\n");
        linesToSkip = 0;
        // Count the kept complete lines: zeroing linesToSkip before this subtraction
        // made the old expression dead and reported `skipped` phantom lines, which
        // stopped the scan before `limit` lines were actually in hand.
        linesCollected = lines.length - 1 - skipped - (endsMidLine ? 1 : 0);
      }
    } else {
      // Windows are concatenated verbatim: a line split across the boundary must stay
      // one line, so no separator may be inserted between them.
      collected = collected === "" ? window.text : collected + window.text;
      linesCollected += lines.length - 1 - (endsMidLine ? 1 : 0);
    }
    if (collected !== "" && (limit > 0 ? linesCollected >= limit : enough(collected))) break;
    if (!window.truncated || position >= READ_SCAN_BUDGET_BYTES) break;
  }
  if (linesToSkip > 0) {
    // The offset was never reached inside the budget.
    return { text: "", moreContent: true, beyondScan: true };
  }
  const lines = toLines(collected);
  const sliced = limit > 0 ? lines.slice(0, limit) : lines;
  return { text: sliced.join("\n"), moreContent, beyondScan: false };
}

async function executeRead(workspace: ToolWorkspace, args: ToolArgs): Promise<ToolExecutionResult> {
  try {
    const view = asWorkspaceView(workspace);
    const filePath = String(args.path ?? "");
    const cap = toolTuningValue("maxFileChars", MAX_FILE);
    const offset = readInt(args, "offset", 0);
    const limit = readInt(args, "limit", 0);
    // Four bytes per character is the UTF-8 upper bound, so the byte cap cannot cut
    // text the char cap wants to keep.
    let text: string;
    let moreContent: boolean;
    let beyondScan = false;
    if (offset > 1) {
      const window = readFromOffset(view.fs, filePath, offset, limit, cap);
      text = window.text;
      moreContent = window.moreContent;
      beyondScan = window.beyondScan;
    } else {
      // Read a bounded head instead of the whole file: an oversized asset used to be
      // fully materialized (and split into lines) before any cap applied.
      const head = view.fs.readFileHead(filePath, cap * 4);
      let lines = toLines(head.text);
      if (limit > 0) lines = lines.slice(0, limit);
      text = lines.join("\n");
      moreContent = head.truncated || lines.length < toLines(head.text).length;
    }
    // Loud, not silent: the model must know it is looking at a prefix — and the note
    // stays inside the same cap, so a tiny cap keeps the old bounded shape.
    const note = beyondScan
      ? `\n…(file longer than ${READ_SCAN_BUDGET_BYTES} bytes: offset ${offset} is beyond the readable window)`
      : "\n…(file longer: read with offset/limit for the rest)";
    const capped = moreContent || text.length > cap;
    const result = capped && cap > note.length ? `${truncate(text, cap - note.length)}${note}` : truncate(text, cap);
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
