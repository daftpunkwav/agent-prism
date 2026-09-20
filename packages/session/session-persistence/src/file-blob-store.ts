/**
 * @file file-blob-store
 * @description Filesystem SessionBlobStore: one text file per ledger blob.
 *
 * Responsibilities:
 * - Persist oversized entry texts beside the session store files
 * - Read back full texts on demand; purge a session's blobs on delete
 *
 * Blobs live OUTSIDE the JSONL log and snapshots on purpose: checkpoints and
 * whole-file rewrites carry entry previews only, never full bodies. Filenames
 * sanitize the session id (ids are operator-visible); unknown keys read as
 * null so a missing blob degrades to the inline preview, never an error.
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SessionBlobStore } from "@agentprism/contracts";

/** Blob filename suffix (session blobs share one directory per store). */
export const BLOB_FILE_SUFFIX = ".blob.txt";

/** Filesystem blob sidecar rooted at one directory (created on demand). */
export class FileBlobStore implements SessionBlobStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** Blob filename infix for one key (operator-safe, bounded, sequence-scoped). */
  static fileName(sessionId: string, seq: number): string {
    const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "session";
    return `${safe}.${seq}${BLOB_FILE_SUFFIX}`;
  }

  async saveBlob(sessionId: string, seq: number, text: string): Promise<void> {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(path.join(this.dir, FileBlobStore.fileName(sessionId, seq)), text, "utf-8");
  }

  async loadBlob(sessionId: string, seq: number): Promise<string | null> {
    try {
      return readFileSync(path.join(this.dir, FileBlobStore.fileName(sessionId, seq)), "utf-8");
    } catch {
      return null;
    }
  }

  async deleteSessionBlobs(sessionId: string): Promise<boolean> {
    let entries: string[];
    try {
      entries = readdirSync(this.dir);
    } catch {
      return false;
    }
    const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "session";
    let removed = false;
    for (const entry of entries) {
      if (entry.startsWith(`${safe}.`) && entry.endsWith(BLOB_FILE_SUFFIX)) {
        try {
          rmSync(path.join(this.dir, entry));
          removed = true;
        } catch {
          // Purge is hygiene: a stuck blob costs disk, and delete() already flushed.
        }
      }
    }
    return removed;
  }
}
