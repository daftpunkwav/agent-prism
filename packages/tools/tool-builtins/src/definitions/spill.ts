/**
 * @file tools/spill
 * @description Shared oversized-result spill: persist-then-prune for tool outputs.
 *
 * Responsibilities:
 * - Persist oversized tool results to workspace .spills/ artifacts (rotated)
 * - Return a bounded head/tail preview plus locator and retrieval guidance
 * - Degrade loudly (never silently, never into an error) when spilling fails
 *
 * Localized DSH spill-policy: tools keep returning plain strings, so the
 * persist-then-prune arm lives at the truncate call sites instead of a
 * post-execute waterfall. Deliberately narrow, mirroring the reference:
 * - Threshold keys on UTF-8 bytes; small results pass through untouched.
 * - The read tool stays on bare truncate (it IS the retrieval path: spill
 *   files are read back with offset/limit, so spilling read outputs would loop).
 * - run-job keeps its own poll-delta spill; result spills use spill-*.txt names
 *   and rotate only those, so the two owners never evict each other.
 * - Best-effort: any filesystem failure degrades to a loud truncated note.
 *   A spill failure must NEVER turn a successful tool call into an error.
 */

import type { ToolWorkspace } from "@agentprism/contracts";
import { MAX_OUTPUT, truncate } from "./caps.js";

/** Minimal filesystem surface for spilling (satisfied by ScopedFileSystem). */
export interface SpillFs {
  writeFile(path: string, content: string): unknown;
  deleteFile(path: string): unknown;
  listFiles(dir: string, options?: { recursive?: boolean }): string[];
}

/** Workspace spill directory (shared with run-job poll spills). */
export const SPILL_DIR = ".spills";
/** Inline budget in UTF-8 bytes; beyond it the full text is spilled, only a preview stays inline. */
export const SPILL_THRESHOLD_BYTES = 32 * 1024;
/** Per-artifact cap in chars; larger bodies are capped loudly inside the artifact. */
export const MAX_SPILL_CHARS = 512 * 1024;
/** Retained spill-*.txt artifacts per workspace; oldest evicted first. */
export const MAX_SPILL_FILES = 20;
/** Result-spill filename prefix (run-job owns *.log; result spills own spill-*.txt). */
export const SPILL_FILE_PREFIX = "spill-";

/** UTF-8 byte length (threshold keys on bytes, previews stay char-based like truncate). */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Model-safe artifact infix derived from the tool name (kebab, bounded). */
function sanitizeSource(source: string): string {
  const clean = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (clean === "" ? "tool" : clean).slice(0, 24);
}

/** Basename of a workspace-relative spill listing entry. */
function baseName(entry: string): string {
  const slash = entry.lastIndexOf("/");
  return slash < 0 ? entry : entry.slice(slash + 1);
}

/** Next artifact sequence, derived from existing names (stateless: no process-global counters). */
function nextSeq(fs: SpillFs): number {
  let max = 0;
  let entries: string[];
  try {
    entries = fs.listFiles(SPILL_DIR, { recursive: false });
  } catch {
    return 1;
  }
  for (const entry of entries) {
    const match = /^spill-(\d+)-/.exec(baseName(entry));
    if (match !== null) {
      const seq = Number(match[1]);
      if (Number.isSafeInteger(seq)) max = Math.max(max, seq);
    }
  }
  return max + 1;
}

/** Evicts oldest spill-*.txt artifacts beyond the retention cap (run-job *.log files untouched). */
function rotate(fs: SpillFs): void {
  let entries: string[];
  try {
    entries = fs.listFiles(SPILL_DIR, { recursive: false });
  } catch {
    return;
  }
  const ours = entries
    .filter((entry) => {
      const base = baseName(entry);
      return base.startsWith(SPILL_FILE_PREFIX) && base.endsWith(".txt");
    })
    .sort();
  for (const extra of ours.slice(0, Math.max(0, ours.length - MAX_SPILL_FILES))) {
    try {
      fs.deleteFile(extra);
    } catch {
      // Rotation is hygiene, not correctness: a stuck file costs disk, not truth.
    }
  }
}

/**
 * Bounds tool text with persist-then-prune: drop-in replacement for truncate()
 * at tool call sites. Small results return exactly truncate(text, maxLength);
 * oversized results persist the full text to .spills/ and return a headed
 * preview with the artifact locator plus read-back guidance.
 *
 * Never throws for spill causes: missing/unusable filesystems and write
 * failures degrade to (loud) truncation. Callers pass the tool workspace
 * untouched; anything that is not a usable fs takes the truncate path.
 *
 * @param workspace Tool workspace (fs used only when it quacks like SpillFs).
 * @param source Tool name used for the artifact filename infix.
 * @param text Full result text to bound.
 * @param maxLength Inline preview budget (chars), same meaning as in truncate.
 * @returns Bounded model-facing text, possibly with a spill locator header.
 */
export function boundText(
  workspace: ToolWorkspace,
  source: string,
  text: string,
  maxLength: number = MAX_OUTPUT,
): string {
  const fs = extractSpillFs(workspace);
  if (fs === null || utf8Bytes(text) <= SPILL_THRESHOLD_BYTES) {
    return truncate(text, maxLength);
  }
  try {
    const seq = nextSeq(fs);
    // Random suffix: seq is derived from a directory listing, so concurrent
    // writers (scatter children share the workspace) can race to the same seq.
    // The suffix keeps such collisions from silently overwriting a sibling's
    // artifact; the nextSeq regex still parses the seq segment unchanged.
    const unique = Math.random().toString(36).slice(2, 8);
    const path = `${SPILL_DIR}/${SPILL_FILE_PREFIX}${String(seq).padStart(6, "0")}-${sanitizeSource(source)}-${unique}.txt`;
    const body =
      text.length > MAX_SPILL_CHARS
        ? `${text.slice(0, MAX_SPILL_CHARS)}\n…(spill capped, ${text.length} chars total)`
        : text;
    fs.writeFile(path, body);
    rotate(fs);
    const header =
      `[output spilled: ${text.length} chars total; full text at ${path} — ` +
      `read it with offset/limit, or grep it for the middle]`;
    return `${header}\n${truncate(text, maxLength)}`;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `${truncate(text, maxLength)}\n(spill failed: ${reason})`;
  }
}

/** Extracts a usable SpillFs from the workspace, or null when it cannot quack like one. */
function extractSpillFs(workspace: ToolWorkspace): SpillFs | null {
  try {
    const fs = (workspace as { fs?: unknown }).fs;
    if (fs === null || typeof fs !== "object") return null;
    const candidate = fs as Record<string, unknown>;
    if (
      typeof candidate.writeFile !== "function" ||
      typeof candidate.deleteFile !== "function" ||
      typeof candidate.listFiles !== "function"
    ) {
      return null;
    }
    return candidate as unknown as SpillFs;
  } catch {
    return null;
  }
}
