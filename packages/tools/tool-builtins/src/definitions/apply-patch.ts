/**
 * @file tools/apply-patch
 * @description Builtin apply_patch tool: create, modify, move, and delete files
 * from one V4A-format patch text.
 *
 * Responsibilities:
 * - Declare the tool's JSON schema
 * - Parse and apply *** Begin Patch format in one call (not atomic: earlier hunks persist on mid-patch failure)
 *
 * The wire format is project-ized from opencode's Patch module (V4A): markers
 * and chunk semantics match, the implementation targets this project's
 * ToolDefinition / ScopedFileSystem ports instead of opencode's Effect stack.
 */

import type { ToolArgs, ToolDefinition, ToolExecutionResult, ToolWorkspace } from "@agentprism/contracts";
import { estimateTokensFromChars } from "@agentprism/contracts";
import { WorkspaceError } from "@agentprism/environment";

import { boundText } from "./spill.js";
import { asWorkspaceView } from "./workspace-view.js";

export const APPLY_PATCH_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    patch: {
      type: "string",
      description:
        "Full V4A patch text: *** Begin Patch, then *** Add File / *** Update File / *** Delete File sections, then *** End Patch. Update chunks use @@ hunks with ' ' context, '-' removal, '+' addition lines; append-at-end hunks may end with *** End of File.",
    },
  },
  required: ["patch"],
  additionalProperties: false,
};

/** One parsed change: add a file, delete a file, or update (optionally move) a file. */
export type PatchHunk =
  | { type: "add"; path: string; contents: string }
  | { type: "delete"; path: string }
  | { type: "update"; path: string; movePath?: string; chunks: PatchChunk[] };

/** One @@ hunk: old lines are removed at the matched position, new lines inserted. */
export interface PatchChunk {
  oldLines: string[];
  newLines: string[];
  endOfFile?: boolean;
}

/** Parses V4A patch text into hunks; throws on malformed input. */
export function parseV4aPatch(patchText: string): PatchHunk[] {
  const lines = patchText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const begin = lines.findIndex((line) => line.trim() === "*** Begin Patch");
  const end = lines.findIndex((line) => line.trim() === "*** End Patch");
  if (begin === -1 || end === -1 || begin >= end) {
    throw new WorkspaceError("Invalid patch format: missing *** Begin Patch / *** End Patch markers");
  }

  const hunks: PatchHunk[] = [];
  let index = begin + 1;
  while (index < end) {
    const line = lines[index];
    if (line === undefined) break;
    if (line.startsWith("*** Add File:")) {
      const path = line.slice("*** Add File:".length).trim();
      if (path === "") throw new WorkspaceError("Invalid patch: Add File path is empty");
      const parsed = parseAdd(lines, index + 1);
      hunks.push({ type: "add", path, contents: parsed.contents });
      index = parsed.next;
      continue;
    }
    if (line.startsWith("*** Delete File:")) {
      const path = line.slice("*** Delete File:".length).trim();
      if (path === "") throw new WorkspaceError("Invalid patch: Delete File path is empty");
      hunks.push({ type: "delete", path });
      index += 1;
      continue;
    }
    if (line.startsWith("*** Update File:")) {
      const path = line.slice("*** Update File:".length).trim();
      if (path === "") throw new WorkspaceError("Invalid patch: Update File path is empty");
      let next = index + 1;
      let movePath: string | undefined;
      const moveLine = lines[next];
      if (moveLine !== undefined && moveLine.startsWith("*** Move to:")) {
        movePath = moveLine.slice("*** Move to:".length).trim();
        if (movePath === "") throw new WorkspaceError("Invalid patch: Move to path is empty");
        next += 1;
      }
      const parsed = parseUpdate(lines, next);
      hunks.push({ type: "update", path, movePath, chunks: parsed.chunks });
      index = parsed.next;
      continue;
    }
    throw new WorkspaceError(`Invalid patch line: ${line.slice(0, 80)}`);
  }
  return hunks;
}

function parseAdd(lines: readonly string[], start: number): { contents: string; next: number } {
  const content: string[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined || line.startsWith("***")) break;
    if (!line.startsWith("+")) {
      throw new WorkspaceError(`Invalid Add File line (expected leading '+'): ${line.slice(0, 80)}`);
    }
    content.push(line.slice(1));
    index += 1;
  }
  return { contents: content.join("\n"), next: index };
}

function parseUpdate(lines: readonly string[], start: number): { chunks: PatchChunk[]; next: number } {
  const chunks: PatchChunk[] = [];
  let index = start;
  while (index < lines.length) {
    const marker = lines[index];
    if (marker === undefined || marker.startsWith("***")) break;
    if (!marker.startsWith("@@")) {
      throw new WorkspaceError(`Invalid Update File chunk (expected '@@'): ${marker.slice(0, 80)}`);
    }
    const chunk: PatchChunk = { oldLines: [], newLines: [] };
    index += 1;
    while (index < lines.length) {
      const line = lines[index];
      if (line === undefined || line.startsWith("@@")) break;
      if (line === "*** End of File") {
        chunk.endOfFile = true;
        index += 1;
        break;
      }
      if (line.startsWith("***")) break;
      if (line.startsWith(" ")) {
        chunk.oldLines.push(line.slice(1));
        chunk.newLines.push(line.slice(1));
      } else if (line.startsWith("-")) {
        chunk.oldLines.push(line.slice(1));
      } else if (line.startsWith("+")) {
        chunk.newLines.push(line.slice(1));
      } else {
        throw new WorkspaceError(`Invalid update chunk line (expected ' ', '-', or '+'): ${line.slice(0, 80)}`);
      }
      index += 1;
    }
    chunks.push(chunk);
  }
  return { chunks, next: index };
}

/**
 * Applies update chunks to file content: each chunk's old lines are located as a
 * contiguous block (scanning forward from the previous chunk's position, then from
 * the top) and replaced by the new lines. An empty-old chunk must be marked
 * `endOfFile` and appends at the end.
 */
export function applyChunks(original: string, chunks: readonly PatchChunk[]): string {
  const lines = original.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  let cursor = 0;
  for (const chunk of chunks) {
    if (chunk.oldLines.length === 0) {
      if (!chunk.endOfFile) {
        throw new WorkspaceError("Invalid update chunk: no context lines (add *** End of File to append)");
      }
      lines.push(...chunk.newLines);
      cursor = lines.length;
      continue;
    }
    const start = locateBlock(lines, chunk.oldLines, cursor);
    if (start === -1) {
      throw new WorkspaceError(`Patch context not found: ${chunk.oldLines[0]?.slice(0, 80) ?? ""}`);
    }
    lines.splice(start, chunk.oldLines.length, ...chunk.newLines);
    cursor = start + chunk.newLines.length;
  }
  return lines.join("\n");
}

/** First index ≥ cursor containing the block as a contiguous subsequence; falls back to a full scan. */
function locateBlock(lines: readonly string[], block: readonly string[], cursor: number): number {
  const limit = lines.length - block.length;
  for (let i = Math.max(0, cursor); i <= limit; i += 1) {
    if (matchesAt(lines, block, i)) return i;
  }
  for (let i = 0; i <= limit; i += 1) {
    if (matchesAt(lines, block, i)) return i;
  }
  return -1;
}

function matchesAt(lines: readonly string[], block: readonly string[], start: number): boolean {
  for (let i = 0; i < block.length; i += 1) {
    if (lines[start + i] !== block[i]) return false;
  }
  return true;
}

async function executeApplyPatch(workspace: ToolWorkspace, args: ToolArgs): Promise<ToolExecutionResult> {
  const view = asWorkspaceView(workspace);
  const patchText = String(args.patch ?? "");
  if (patchText.trim() === "") {
    return { result: "Error: patch must not be empty", fileDiff: null, ok: false, code: "workspace_error" };
  }
  let hunks: PatchHunk[];
  try {
    hunks = parseV4aPatch(patchText);
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return { result: error.message, fileDiff: null, ok: false, code: "workspace_error" };
    }
    throw error;
  }
  if (hunks.length === 0) {
    return { result: "Error: patch contains no file sections", fileDiff: null, ok: false, code: "workspace_error" };
  }

  const notes: string[] = [];
  try {
    for (const hunk of hunks) {
      if (hunk.type === "add") {
        // createFile (not writeFile): "Add File" over an existing file must fail loudly
        // instead of silently clobbering, mirroring opencode's apply_patch semantics.
        view.fs.createFile(hunk.path, hunk.contents);
        notes.push(`Created ${hunk.path} (~${estimateTokensFromChars(hunk.contents.length)} tokens)`);
        continue;
      }
      if (hunk.type === "delete") {
        view.fs.deleteFile(hunk.path);
        notes.push(`Deleted ${hunk.path}`);
        continue;
      }
      const updated = applyChunks(view.fs.readFile(hunk.path), hunk.chunks);
      // A same-path "*** Move to:" is a plain update: writing then deleting the
      // same path would erase the just-edited file instead of editing in place.
      const movePath = hunk.movePath !== hunk.path ? hunk.movePath : undefined;
      const target = movePath ?? hunk.path;
      view.fs.writeFile(target, updated);
      if (movePath !== undefined) view.fs.deleteFile(hunk.path);
      notes.push(movePath !== undefined ? `Moved ${hunk.path} → ${movePath}` : `Edited ${hunk.path}`);
    }
  } catch (error) {
    if (error instanceof WorkspaceError) {
      // Mid-patch failures surface as a tool error so the model can retry; applied
      // earlier hunks remain (per-file operations are individually consistent).
      return { result: `Error: ${error.message}`, fileDiff: null, ok: false, code: "workspace_error" };
    }
    throw error;
  }
  return { result: boundText(workspace, "apply_patch", notes.join("\n")), fileDiff: notes.join("\n"), ok: true };
}

/** Builtin apply_patch tool definition. */
export const applyPatchTool: ToolDefinition = {
  name: "apply_patch",
  description:
    "Create, modify, move, and delete files from one V4A patch text (*** Begin Patch with Add/Update/Delete File sections). Use instead of repeated write/edit calls when touching several files.",
  jsonSchema: APPLY_PATCH_JSON_SCHEMA,
  mutatesWorkspace: true,
  execute: executeApplyPatch,
};
