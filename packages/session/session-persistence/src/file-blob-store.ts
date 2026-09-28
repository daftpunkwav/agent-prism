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

import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SessionBlobStore } from "@agentprism/contracts";

/** Blob filename suffix (session blobs share one directory per store). */
export const BLOB_FILE_SUFFIX = ".blob.txt";

/**
 * FNV-1a of the raw session id, base-36: distinct ids whose sanitized forms
 * collide ("session/1" and "session_1" both sanitize to "session_1") still get
 * distinct filename prefixes, so blobs can never cross-talk between sessions.
 */
function sessionIdHash(sessionId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < sessionId.length; i += 1) {
    hash ^= sessionId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Sanitized session-id infix shared by the filename and the purge prefix. */
function safeInfix(sessionId: string): string {
  return `${sessionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "session"}.${sessionIdHash(sessionId)}`;
}

/** Filesystem blob sidecar rooted at one directory (created on demand). */
export class FileBlobStore implements SessionBlobStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** Blob filename infix for one key (operator-safe, bounded, sequence-scoped). */
  static fileName(sessionId: string, seq: number): string {
    return `${safeInfix(sessionId)}.${seq}${BLOB_FILE_SUFFIX}`;
  }

  async saveBlob(sessionId: string, seq: number, text: string): Promise<void> {
    mkdirSync(this.dir, { recursive: true });
    const target = path.join(this.dir, FileBlobStore.fileName(sessionId, seq));
    // Torn-write containment: a crash mid-write must never leave a partial blob
    // that reads back as truncated ledger text. Same-volume rename is atomic.
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, text, "utf-8");
    renameSync(tmp, target);
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
    const prefix = `${safeInfix(sessionId)}.`;
    let removed = false;
    for (const entry of entries) {
      // The .tmp twin of an atomic write (crash between write and rename) is
      // purged alongside the blob, so a torn write never leaks disk.
      const isBlob = entry.endsWith(BLOB_FILE_SUFFIX) || entry.endsWith(`${BLOB_FILE_SUFFIX}.tmp`);
      if (entry.startsWith(prefix) && isBlob) {
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
