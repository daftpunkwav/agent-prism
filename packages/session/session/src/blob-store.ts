/**
 * @file blob-store
 * @description Ledger blob sidecar: full texts for oversized session entries.
 *
 * Responsibilities:
 * - Define the in-memory SessionBlobStore (default for every backend)
 * - Spill oversized entry texts: full body to the sidecar, preview plus
 *   locator into the entry (localized DSH spill-policy, ledger arm)
 *
 * Entries keep the 8000-char inline budget; only the SHAPE of oversized
 * content changes (locator-first preview instead of a silent head cut).
 * The locator leads on purpose: entry readers slice the first ~300 chars,
 * so a trailing locator would never be discovered.
 */

import type { SessionBlobStore } from "@agentprism/contracts";
import { MAX_ENTRY_CONTENT_CHARS } from "./in-memory-session-store.js";

/** Per-blob cap in chars; larger bodies are capped loudly inside the blob. */
export const LEDGER_BLOB_MAX_CHARS = 128 * 1024;
/** Preview head budget (chars): enough context to orient, small enough to quote. */
export const LEDGER_PREVIEW_HEAD_CHARS = 1500;
/** Preview tail budget (chars): conclusions and error tails live at the end. */
export const LEDGER_PREVIEW_TAIL_CHARS = 500;

/** In-memory blob sidecar: ephemeral (tests, tooling); blobs die with the process. */
export class InMemoryBlobStore implements SessionBlobStore {
  private readonly blobs = new Map<string, string>();

  /**
   * Blob key for one entry (stable across backends and restarts; session ids
   * never contain a colon — production ids are 12-hex, see RandomIdGenerator).
   */
  static key(sessionId: string, seq: number): string {
    return `${sessionId}:${seq}`;
  }

  async saveBlob(sessionId: string, seq: number, text: string): Promise<void> {
    this.blobs.set(InMemoryBlobStore.key(sessionId, seq), text);
  }

  async loadBlob(sessionId: string, seq: number): Promise<string | null> {
    return this.blobs.get(InMemoryBlobStore.key(sessionId, seq)) ?? null;
  }

  async deleteSessionBlobs(sessionId: string): Promise<boolean> {
    let removed = false;
    for (const key of [...this.blobs.keys()]) {
      if (key.startsWith(`${sessionId}:`)) {
        this.blobs.delete(key);
        removed = true;
      }
    }
    return removed;
  }
}

/**
 * Locator-first preview for a spilled entry: the locator MUST lead because
 * entry readers (session_query, projections) quote only the first ~300 chars.
 * Head plus tail preserve orientation and conclusions around a count marker.
 *
 * @param content Full entry text (already trimmed by the caller).
 * @param sessionId Owning session, rendered into the locator.
 * @param seq Entry sequence, rendered into the locator.
 * @returns Bounded entry content (well under MAX_ENTRY_CONTENT_CHARS).
 */
export function formatSpilledEntry(content: string, sessionId: string, seq: number): string {
  const marker = `\n…[middle spilled: ${content.length} chars total]…\n`;
  const head = content.slice(0, LEDGER_PREVIEW_HEAD_CHARS);
  const tail =
    content.length > LEDGER_PREVIEW_HEAD_CHARS
      ? content.slice(content.length - LEDGER_PREVIEW_TAIL_CHARS)
      : "";
  const locator =
    `[ledger blob: ${content.length} chars — full text via ` +
    `session_query action=read_entry id=${sessionId} seq=${seq}]`;
  return `${locator}\n${head}${tail === "" ? "" : marker + tail}`;
}

/**
 * Bounds one entry's content with persist-then-prune. Small contents return
 * unchanged (existing 8000-char behavior is preserved exactly); oversized
 * contents persist the full body (loudly capped per blob) and return the
 * locator-first preview. Never throws for blob causes: a failed save degrades
 * to a loud head cut so a spill failure can never lose the append.
 *
 * @param blobs Sidecar receiving the full text (keyed by sessionId and seq).
 * @param sessionId Owning session id.
 * @param seq Entry sequence (dense per session, assigned by the caller).
 * @param content Full entry text (already trimmed by the caller).
 * @returns Bounded entry content for the ledger.
 */
export async function spillOversizedEntry(
  blobs: SessionBlobStore,
  sessionId: string,
  seq: number,
  content: string,
): Promise<string> {
  if (content.length <= MAX_ENTRY_CONTENT_CHARS) return content;
  const body =
    content.length > LEDGER_BLOB_MAX_CHARS
      ? `${content.slice(0, LEDGER_BLOB_MAX_CHARS)}\n…(ledger blob capped, ${content.length} chars total)`
      : content;
  try {
    await blobs.saveBlob(sessionId, seq, body);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `${content.slice(0, MAX_ENTRY_CONTENT_CHARS)}\n(ledger blob failed: ${reason})`;
  }
  return formatSpilledEntry(content, sessionId, seq);
}
