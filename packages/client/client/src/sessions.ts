/**
 * @file sessions
 * @description Browser API client for the execution-session ledger routes.
 *
 * Responsibilities:
 * - Filtered session listing, detail with milestone entries, operator delete
 *
 * Thin transport only: no state, no retry policy, no UI concerns.
 */

import { API_BASE, ApiError, apiFetch, responseDetail } from "./http.js";
import type { SessionEntry, SessionKind, SessionRecord, SessionStatus } from "./types.js";

/** Session detail: record plus its milestone entries (newest-first). */
export interface SessionDetail {
  record: SessionRecord;
  entries: SessionEntry[];
}

/** Ledger stats: counts over the stored window (same cap as listings). */
export interface SessionStats {
  total: number;
  byKind: Record<SessionKind, number>;
  byStatus: Record<SessionStatus, number>;
}

/** Export envelope: versioned record plus newest-first entries for backup and forensics. */
export interface SessionExport {
  version: 1;
  exportedAt: number;
  record: SessionRecord;
  entries: SessionEntry[];
}

/** List filters: every set field must match (server enforces the same rule). */
export interface SessionListFilter {
  kind?: SessionKind;
  status?: SessionStatus;
  limit?: number;
}

/**
 * Lists execution sessions newest-first with optional exact-match filters.
 *
 * @param filter kind/status subset plus result limit (server clamps the limit).
 * @param signal AbortSignal for unmount-safe cancellation.
 * @returns Session records (`sessions` payload, never null).
 * @throws ApiError on HTTP failure (bad filter values 400).
 */
export async function listSessions(filter: SessionListFilter = {}, signal?: AbortSignal): Promise<SessionRecord[]> {
  const params = new URLSearchParams();
  if (filter.kind !== undefined) params.set("kind", filter.kind);
  if (filter.status !== undefined) params.set("status", filter.status);
  if (filter.limit !== undefined) params.set("limit", String(filter.limit));
  const query = params.size > 0 ? `?${params.toString()}` : "";
  const res = await apiFetch(`${API_BASE}/api/sessions${query}`, { cache: "no-store", signal });
  if (!res.ok) throw new ApiError(await responseDetail(res, "Failed to load sessions"), "http", res.status);
  const data = await res.json();
  return data.sessions || [];
}

/**
 * Loads one session record plus its newest-first milestone entries.
 *
 * @param sessionId Session id from the listing (URL-encoded).
 * @returns Record plus entries detail payload.
 * @throws ApiError on HTTP failure (unknown id 404s).
 */
export async function getSessionDetail(sessionId: string, signal?: AbortSignal): Promise<SessionDetail> {
  const res = await apiFetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}`, {
    cache: "no-store",
    signal,
  });
  if (!res.ok) throw new ApiError(await responseDetail(res, "Failed to load session"), "http", res.status);
  return res.json();
}

/**
 * Deletes a session record plus its entries (ledger curation before the store cap).
 *
 * @param sessionId Session id from the listing (URL-encoded).
 * @returns Resolves void on success.
 * @throws ApiError on HTTP failure (unknown id 404s); caller confirms first.
 */
export async function deleteSession(sessionId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(await responseDetail(res, "Failed to delete session"), "http", res.status);
}

/**
 * Loads ledger counts over the stored window (same cap as listings).
 *
 * @returns Total plus per-kind/per-status breakdowns.
 * @throws ApiError on HTTP failure.
 */
export async function getSessionStats(signal?: AbortSignal): Promise<SessionStats> {
  const res = await apiFetch(`${API_BASE}/api/sessions/stats`, { cache: "no-store", signal });
  if (!res.ok) throw new ApiError(await responseDetail(res, "Failed to load session stats"), "http", res.status);
  return res.json();
}

/**
 * Exports one session as a versioned envelope for backup and forensics.
 *
 * @param sessionId Session id from the listing (URL-encoded).
 * @returns Versioned envelope: export timestamp, record, newest-first entries.
 * @throws ApiError on HTTP failure (unknown id 404s).
 */
export async function exportSession(sessionId: string, signal?: AbortSignal): Promise<SessionExport> {
  const res = await apiFetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/export`, {
    cache: "no-store",
    signal,
  });
  if (!res.ok) throw new ApiError(await responseDetail(res, "Failed to export session"), "http", res.status);
  return res.json();
}
