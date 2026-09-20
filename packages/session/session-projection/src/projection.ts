/**
 * @file session-projection/projection
 * @description Read projections over session documents (digest views).
 *
 * Responsibilities:
 * - Project envelopes into UI-sized views (record digest, entry windows)
 * - Roll verdicts up into per-session outcomes
 * - Keep projections pure over caller-supplied snapshots (no IO)
 *
 * Views bound what the sessions UI and forensics tools load: full transcripts
 * never travel when a digest plus a window suffices. Projection inputs are
 * v2 documents (migrate first); malformed inputs yield empty views, never throws.
 */

import type { SessionEntry, SessionRecord } from "@agentprism/contracts";
import type { SessionDocumentV2 } from "@agentprism/session-format";

/** One session digest row for list UIs. */
export interface SessionDigest {
  id: string;
  kind: SessionRecord["kind"];
  title: string;
  status: SessionRecord["status"];
  updatedAt: number;
  summary: string | null;
  entryCount: number;
  verdicts: number;
  lastEntryAt: number | null;
}

/** A window of entries (newest-first) with totals for pagination. */
export interface EntryWindow {
  sessionId: string;
  entries: SessionEntry[];
  total: number;
  limit: number;
  offset: number;
}

/** Verdict rollup for one session. */
export interface VerdictRollup {
  sessionId: string;
  passed: number;
  failed: number;
  notes: number;
  /** Latest verdict content preview (null when no verdicts). */
  latest: string | null;
}

/** Projects one document into a digest row (never throws). */
export function projectDigest(document: SessionDocumentV2): SessionDigest {
  const entries = Array.isArray(document.entries) ? document.entries : [];
  let verdicts = 0;
  let lastEntryAt: number | null = null;
  for (const entry of entries) {
    if (entry.kind === "verdict") verdicts += 1;
    if (typeof entry.at === "number" && (lastEntryAt === null || entry.at > lastEntryAt)) {
      lastEntryAt = entry.at;
    }
  }
  return {
    id: document.record.id,
    kind: document.record.kind,
    title: document.record.title,
    status: document.record.status,
    updatedAt: document.record.updatedAt,
    summary: document.record.summary,
    entryCount: entries.length,
    verdicts,
    lastEntryAt,
  };
}

/**
 * Projects a newest-first entry window (offset/limit applied after ordering).
 * Limits clamp to [1, 500]; offsets floor at 0.
 */
export function projectEntryWindow(
  sessionId: string,
  entries: readonly SessionEntry[],
  options: { limit?: number; offset?: number } = {},
): EntryWindow {
  const limit = Math.min(500, Math.max(1, Math.floor(options.limit ?? 50)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const ordered = [...entries].sort((a, b) => b.seq - a.seq);
  return {
    sessionId,
    entries: ordered.slice(offset, offset + limit).map((entry) => ({ ...entry })),
    total: ordered.length,
    limit,
    offset,
  };
}

/** Rolls verdict/note entries into an outcome summary (never throws). */
export function rollupVerdicts(sessionId: string, entries: readonly SessionEntry[]): VerdictRollup {
  let passed = 0;
  let failed = 0;
  let notes = 0;
  let latest: { seq: number; content: string } | null = null;
  for (const entry of entries) {
    if (entry.kind === "verdict") {
      const text = entry.content.toLowerCase();
      if (text.includes("pass") && !text.includes("fail")) passed += 1;
      else failed += 1;
      if (latest === null || entry.seq > latest.seq) {
        latest = { seq: entry.seq, content: entry.content.slice(0, 200) };
      }
    } else if (entry.kind === "note") {
      notes += 1;
    }
  }
  return { sessionId, passed, failed, notes, latest: latest?.content ?? null };
}
