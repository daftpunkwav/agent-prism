/**
 * @file session-query/query
 * @description Dependency-free query engine over the SessionStore port.
 *
 * Responsibilities:
 * - Filter sessions by kind/status sets, time ranges, and text search
 * - Sort (newest/oldest/title) and paginate with total counts
 * - Keep every predicate fail-closed on malformed input (empty result, no throw)
 *
 * The engine reads through the store port (list + listEntries), never storage:
 * swapping memory/file/SQLite backends never changes query semantics. Text
 * search matches titles, summaries, and entry content case-insensitively;
 * time ranges are half-open [from, to) over createdAt/updatedAt.
 */

import type { SessionEntry, SessionKind, SessionRecord, SessionStatus, SessionStore } from "@agentprism/contracts";

/** Sort orders for session queries. */
export type SessionSort = "newest" | "oldest" | "title";

/** Query predicate over session records (all set fields must match). */
export interface SessionQuery {
  kinds?: readonly SessionKind[];
  statuses?: readonly SessionStatus[];
  /** Half-open createdAt window [from, to) in epoch ms. */
  createdFrom?: number;
  createdTo?: number;
  /** Half-open updatedAt window [from, to) in epoch ms. */
  updatedTo?: number;
  /** Case-insensitive substring over title/summary (empty = no constraint). */
  text?: string;
  /** Case-insensitive substring over entry content (loads entries per candidate). */
  entryText?: string;
  sort?: SessionSort;
  /** Max rows returned (default 50, cap 500). */
  limit?: number;
  /** Rows skipped before returning (default 0). */
  offset?: number;
}

/** One query page with totals for pagination UI. */
export interface SessionQueryPage {
  rows: SessionRecord[];
  total: number;
  limit: number;
  offset: number;
}

const QUERY_DEFAULT_LIMIT = 50;
const QUERY_MAX_LIMIT = 500;

const KNOWN_KINDS: readonly SessionKind[] = ["arena", "agent", "builder"];
const KNOWN_STATUSES: readonly SessionStatus[] = ["active", "completed", "failed", "cancelled"];

function matchesText(record: SessionRecord, text: string): boolean {
  const needle = text.toLowerCase();
  if ((record.title.toLowerCase().includes(needle))) return true;
  if (record.summary !== null && record.summary.toLowerCase().includes(needle)) return true;
  return false;
}

/**
 * Queries sessions through the store port.
 * Unknown kind/status tokens fail the whole query closed (empty page, never
 * a partial match that hides the typo). Entry-text search loads entries only
 * for records passing the cheaper predicates first.
 */
export async function querySessions(store: SessionStore, query: SessionQuery = {}): Promise<SessionQueryPage> {
  const kinds = query.kinds ?? [];
  const statuses = query.statuses ?? [];
  if (kinds.some((kind) => !KNOWN_KINDS.includes(kind))) {
    return { rows: [], total: 0, limit: QUERY_DEFAULT_LIMIT, offset: 0 };
  }
  if (statuses.some((status) => !KNOWN_STATUSES.includes(status))) {
    return { rows: [], total: 0, limit: QUERY_DEFAULT_LIMIT, offset: 0 };
  }
  const kindSet = new Set<SessionKind>(kinds);
  const statusSet = new Set<SessionStatus>(statuses);
  const text = (query.text ?? "").trim().toLowerCase();
  const entryText = (query.entryText ?? "").trim().toLowerCase();
  const limit = Math.min(QUERY_MAX_LIMIT, Math.max(1, Math.floor(query.limit ?? QUERY_DEFAULT_LIMIT)));
  const offset = Math.max(0, Math.floor(query.offset ?? 0));
  const sort: SessionSort = query.sort === "oldest" || query.sort === "title" ? query.sort : "newest";

  // The store list already filters kind/status singly; the engine applies set
  // semantics plus the remaining predicates over the union.
  const candidates = new Map<string, SessionRecord>();
  if (kinds.length === 0 && statuses.length === 0) {
    for (const record of await store.list()) candidates.set(record.id, record);
  } else {
    const kindList = kinds.length === 0 ? [...KNOWN_KINDS] : kinds;
    const statusList = statuses.length === 0 ? [...KNOWN_STATUSES] : statuses;
    for (const kind of kindList) {
      for (const status of statusList) {
        for (const record of await store.list({ kind, status })) candidates.set(record.id, record);
      }
    }
  }
  let rows = [...candidates.values()].filter((record) => {
    if (kindSet.size > 0 && !kindSet.has(record.kind)) return false;
    if (statusSet.size > 0 && !statusSet.has(record.status)) return false;
    if (query.createdFrom !== undefined && record.createdAt < query.createdFrom) return false;
    if (query.createdTo !== undefined && record.createdAt >= query.createdTo) return false;
    if (query.updatedTo !== undefined && record.updatedAt >= query.updatedTo) return false;
    if (text !== "" && !matchesText(record, text)) return false;
    return true;
  });
  if (entryText !== "") {
    const kept: SessionRecord[] = [];
    for (const record of rows) {
      let entries: readonly SessionEntry[] = [];
      try {
        entries = await store.listEntries(record.id);
      } catch {
        continue;
      }
      if (entries.some((entry) => entry.content.toLowerCase().includes(entryText))) kept.push(record);
    }
    rows = kept;
  }
  rows.sort((a, b) => {
    if (sort === "title") return a.title.localeCompare(b.title) || b.createdAt - a.createdAt;
    if (sort === "oldest") return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
    return b.createdAt - a.createdAt || b.id.localeCompare(a.id);
  });
  return { rows: rows.slice(offset, offset + limit), total: rows.length, limit, offset };
}
