/**
 * @file session-query/aggregate
 * @description Session aggregations: counts, entry histograms, activity windows.
 *
 * Responsibilities:
 * - Count sessions by kind/status without loading entries
 * - Build entry-kind histograms and per-day activity series
 * - Keep aggregations pure over record/entry snapshots
 *
 * Aggregates power the sessions dashboard (statistics bar, activity sparklines)
 * without N+1 entry loads: histograms take caller-supplied entry snapshots so
 * the host decides the loading budget.
 */

import type { SessionEntry, SessionKind, SessionRecord, SessionStatus } from "@agentprism/contracts";

/** Counts grouped by kind then status. */
export type SessionCounts = Record<SessionKind, Record<SessionStatus, number>>;

const KINDS: SessionKind[] = ["arena", "agent", "builder"];
const STATUSES: SessionStatus[] = ["active", "completed", "failed", "cancelled"];

/** Zero-filled counts table. */
export function emptyCounts(): SessionCounts {
  const out = {} as SessionCounts;
  for (const kind of KINDS) {
    out[kind] = { active: 0, completed: 0, failed: 0, cancelled: 0 };
  }
  return out;
}

/** Counts records by kind/status (unknown enum values are ignored, not thrown). */
export function countSessions(records: readonly SessionRecord[]): SessionCounts {
  const counts = emptyCounts();
  for (const record of records) {
    if (!KINDS.includes(record.kind) || !STATUSES.includes(record.status)) continue;
    counts[record.kind][record.status] += 1;
  }
  return counts;
}

/** Entry-kind histogram over snapshots. */
export function entryHistogram(entries: readonly SessionEntry[]): Record<SessionEntry["kind"], number> {
  const histogram: Record<SessionEntry["kind"], number> = { lifecycle: 0, verdict: 0, note: 0 };
  for (const entry of entries) {
    if (entry.kind === "lifecycle" || entry.kind === "verdict" || entry.kind === "note") {
      histogram[entry.kind] += 1;
    }
  }
  return histogram;
}

/** One UTC-day activity bucket. */
export interface ActivityBucket {
  day: string;
  sessions: number;
}

/**
 * Buckets session creation days (`YYYY-MM-DD`, UTC) over an optional window.
 * Buckets sort ascending; days outside [from, to) are excluded when set.
 */
export function activityByDay(
  records: readonly SessionRecord[],
  options: { from?: number; to?: number } = {},
): ActivityBucket[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    if (!Number.isFinite(record.createdAt)) continue;
    if (options.from !== undefined && record.createdAt < options.from) continue;
    if (options.to !== undefined && record.createdAt >= options.to) continue;
    const day = new Date(record.createdAt).toISOString().slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, sessions]) => ({ day, sessions }));
}
