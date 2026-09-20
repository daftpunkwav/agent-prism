/**
 * @file session-service
 * @description Execution-session use cases over the SessionStore seam.
 *
 * Responsibilities:
 * - Start/complete/fail sessions and append milestone entries
 * - Serve record-plus-entries detail, filtered query pages, and stats
 * - Project digest/verdict views through the session-projection cache
 * - Emit lifecycle telemetry and versioned export envelopes
 *
 * Thin orchestration only: lifecycle invariants live in the store backends;
 * querying, projection, titling, and telemetry semantics live in the session
 * family libraries this service wires together.
 */

import type { Clock, SessionEntry, SessionKind, SessionListFilter, SessionRecord, SessionStatus, SessionStore } from "@agentprism/contracts";
import { SystemClock } from "@agentprism/runtime";
import {
  countSessions,
  exportSessionDocument,
  querySessions,
  type SessionExportDocument,
  type SessionQuery,
  type SessionQueryPage,
} from "@agentprism/session-query";
import { firstUsableTitle } from "@agentprism/session-title";
import { ProjectionCache, digestFor, projectEntryWindow, type EntryWindow, type VerdictRollup } from "@agentprism/session-projection";
import { SessionTelemetry, renderTelemetryReport } from "@agentprism/session-telemetry";

/** Session detail: record plus its milestone entries (newest-first). */
export interface SessionDetail {
  record: SessionRecord;
  entries: readonly SessionEntry[];
  /** Additive digest projection with the verdict rollup (cache-backed). */
  projection: { digest: string; verdicts: VerdictRollup };
}

/** Ledger stats: counts over the stored window (same cap as listings). */
export interface SessionStats {
  total: number;
  byKind: Record<SessionKind, number>;
  byStatus: Record<SessionStatus, number>;
}

export interface SessionServiceDeps {
  store: SessionStore;
  /** Injected time for telemetry and export stamps (defaults to the system clock). */
  clock?: Clock;
}

/** Execution-session use cases: lifecycle plus read models for the API. */
export class SessionService {
  private readonly store: SessionStore;
  private readonly clock: Clock;
  private readonly telemetry = new SessionTelemetry();
  private readonly projections = new ProjectionCache();

  constructor(deps: SessionServiceDeps) {
    this.store = deps.store;
    this.clock = deps.clock ?? new SystemClock();
  }

  /** Starts an active session; blank/hostile titles normalize or fall back. */
  async startSession(kind: SessionKind, title: string, metadata?: SessionRecord["metadata"]): Promise<SessionRecord> {
    const record = await this.store.create({ kind, title: firstUsableTitle([title]), metadata });
    this.telemetry.started(record.id, kind, this.clock.now());
    return record;
  }

  /** Appends a milestone entry to a live session. */
  async appendEntry(sessionId: string, kind: SessionEntry["kind"], content: string): Promise<SessionEntry> {
    const entry = await this.store.appendEntry(sessionId, { kind, content });
    this.telemetry.entries(sessionId, 1);
    return entry;
  }

  /** Marks completed with an optional summary and extra counters. */
  async completeSession(id: string, summary?: string, metadata?: SessionRecord["metadata"]): Promise<SessionRecord> {
    const record = await this.store.complete(id, { summary, metadata });
    this.telemetry.settledTransition(id, "completed", this.clock.now());
    return record;
  }

  /** Marks cancelled by the requester. */
  async cancelSession(id: string, reason?: string): Promise<SessionRecord> {
    const record = await this.store.cancel(id, reason);
    this.telemetry.settledTransition(id, "cancelled", this.clock.now());
    return record;
  }

  /** Marks failed with a (caller-sanitized) reason. */
  async failSession(id: string, reason: string): Promise<SessionRecord> {
    const record = await this.store.fail(id, reason);
    this.telemetry.settledTransition(id, "failed", this.clock.now());
    return record;
  }

  /**
   * Record plus entries (or a bounded newest-first window), with the digest
   * projection and verdict rollup served through the LRU projection cache.
   * Null when unknown (the route maps null to 404).
   */
  async getSession(id: string, window?: { limit?: number; offset?: number }): Promise<SessionDetail | null> {
    const record = await this.store.get(id);
    if (record === null) return null;
    const entries = await this.store.listEntries(id);
    // Digest keys on the entries actually loaded (not record.entryCount): the
    // cache never depends on individual stores maintaining the mirror count.
    const view = this.projections.view(id, digestFor(record.updatedAt, entries.length), {
      version: 2,
      record,
      entries: [...entries],
    });
    if (window !== undefined) {
      const page: EntryWindow = projectEntryWindow(id, entries, window);
      return { record, entries: page.entries, projection: { digest: view.digest, verdicts: view.rollup } };
    }
    return { record, entries, projection: { digest: view.digest, verdicts: view.rollup } };
  }

  /**
   * Deletes a record plus its entries; false when unknown. Exists so operators
   * can curate the ledger before the store cap write-blocks creation.
   */
  async deleteSession(id: string): Promise<boolean> {
    const deleted = await this.store.delete(id);
    if (deleted) this.projections.invalidate(id);
    return deleted;
  }

  listSessions(filter: SessionListFilter = {}): Promise<readonly SessionRecord[]> {
    return this.store.list(filter);
  }

  /** Filtered/sorted/paginated query page over the store (session-query engine). */
  searchSessions(query: SessionQuery = {}): Promise<SessionQueryPage> {
    return querySessions(this.store, query);
  }

  /**
   * Full spilled text for one ledger blob entry; null when the entry is
   * inline, unknown, or the backend has no blobs (read path never throws).
   */
  async readSessionBlob(id: string, seq: number): Promise<string | null> {
    try {
      return (await this.store.readBlob?.(id, seq)) ?? null;
    } catch {
      return null;
    }
  }

  /** Counts over the stored window (same store cap as listings, never the full history). */
  async getSessionStats(): Promise<SessionStats> {
    const records = await this.store.list({});
    const matrix = countSessions(records);
    const byKind = { arena: 0, agent: 0, builder: 0 } as Record<SessionKind, number>;
    const byStatus = { active: 0, completed: 0, failed: 0, cancelled: 0 } as Record<SessionStatus, number>;
    for (const kind of Object.keys(matrix) as SessionKind[]) {
      for (const status of Object.keys(matrix[kind]) as SessionStatus[]) {
        byKind[kind] += matrix[kind][status];
        byStatus[status] += matrix[kind][status];
      }
    }
    return { total: records.length, byKind, byStatus };
  }

  /**
   * Self-describing export envelope for backup and forensics (learned from a
   * corrupted session file wiping the ledger). Carries the current session-format
   * envelope version so restores route through the migrator; entries ride along
   * seq-ascending.
   */
  async exportSession(id: string): Promise<SessionExportDocument | null> {
    const detail = await this.getSession(id);
    if (detail === null) return null;
    return exportSessionDocument(detail.record, detail.entries, this.clock.now());
  }

  /** Batch export (capped; missing ids skipped, never throws for one bad id). */
  async exportSessions(ids: readonly string[], cap: number = 50): Promise<SessionExportDocument[]> {
    const out: SessionExportDocument[] = [];
    for (const id of ids.slice(0, Math.max(1, Math.min(50, Math.trunc(cap))))) {
      try {
        const doc = await this.exportSession(id);
        if (doc !== null) out.push(doc);
      } catch {
        continue;
      }
    }
    return out;
  }

  /** Deterministic telemetry report lines (empty kinds omitted). */
  telemetryReport(): string {
    return renderTelemetryReport(this.telemetry);
  }
}
