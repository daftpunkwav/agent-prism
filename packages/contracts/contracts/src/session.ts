/**
 * @file session
 * @description Durable execution-session vocabulary shared across packages.
 *
 * Responsibilities:
 * - Define session records, milestone entries, and store failure modes
 *
 * Sessions track execution lifecycles (arena runs, agent runs); authoring
 * sessions (builder) keep their own store. Storage lives behind the
 * SessionStore port owned by the session family.
 */

import { z } from "zod";
import type { Clock, IdGenerator } from "./ports.js";

/** Execution-session origin: which subsystem owns the lifecycle. */
export type SessionKind = "arena" | "agent" | "builder";

/** Lifecycle state: active until completed, failed, or cancelled by the requester. */
export type SessionStatus = "active" | "completed" | "failed" | "cancelled";

/** Durable execution-session record. */
export interface SessionRecord {
  id: string;
  kind: SessionKind;
  title: string;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  /** Short human summary set at completion; null while active or unsummarized. */
  summary: string | null;
  /** Small factual counters/snapshots (counts, not transcripts). */
  metadata: Record<string, string | number | boolean>;
  entryCount: number;
}

/** Coarse milestone appended to a session (lifecycle markers, not event streams). */
export interface SessionEntry {
  sessionId: string;
  seq: number;
  at: number;
  /** Milestone channel: lifecycle transitions, verdicts, operator notes. */
  kind: "lifecycle" | "verdict" | "note";
  content: string;
}

/** Creation input: identity and clock are store-assigned. */
export interface SessionCreateInput {
  kind: SessionKind;
  title: string;
  metadata?: Record<string, string | number | boolean>;
}

/** Completion patch: summary and extra counters merged at finish time. */
export interface SessionFinishInput {
  summary?: string;
  metadata?: Record<string, string | number | boolean>;
}

/** List filter: every set field must match; results newest-first. */
export interface SessionListFilter {
  kind?: SessionKind;
  status?: SessionStatus;
  limit?: number;
}

/** POST /api/sessions/export request: batch export by id (capped; missing ids skipped). */
export const SessionExportRequestSchema = z.object({
  ids: z.array(z.string().min(1).max(128)).min(1).max(50),
});
export type SessionExportRequest = z.infer<typeof SessionExportRequestSchema>;

/**
 * Read-only session query port for agent tools (implemented by the application
 * session service; consumed by the agent layer through dependency inversion).
 * List/detail shapes reuse the store vocabulary so no new types are needed.
 */
export interface SessionQueryPort {
  /** Newest-first records matching every set filter field. */
  listSessions(filter?: SessionListFilter): Promise<readonly SessionRecord[]>;
  /** Record plus milestone entries, or null when unknown (no throw on read). */
  getSession(id: string): Promise<{ record: SessionRecord; entries: readonly SessionEntry[] } | null>;
  /**
   * Full spilled text for one ledger blob entry, or null when unknown,
   * unsupported, or lost (memory-only blobs do not survive restarts).
   * Optional so older implementers keep working; absent reads as unsupported.
   */
  readSessionBlob?(id: string, seq: number): Promise<string | null>;
}

/**
 * Sidecar store for oversized ledger entry texts.
 *
 * Entries stay small (previews plus locators); the full text lives here keyed
 * by (sessionId, seq). Separate from the entry log on purpose: snapshots and
 * whole-file rewrites carry previews only, never the full bodies.
 */
export interface SessionBlobStore {
  /** Persists the full entry text (overwrites any previous blob for the key). */
  saveBlob(sessionId: string, seq: number, text: string): Promise<void>;
  /** Full entry text, or null when no blob exists for the key (no throw on read). */
  loadBlob(sessionId: string, seq: number): Promise<string | null>;
  /** Drops every blob for one session; false when nothing was stored (no throw). */
  deleteSessionBlobs(sessionId: string): Promise<boolean>;
}

/** Session id is unknown to the store. */
export class SessionNotFoundError extends Error {
  readonly sessionId: string;
  constructor(sessionId: string) {
    super(`Unknown session: ${sessionId}`);
    this.name = "SessionNotFoundError";
    this.sessionId = sessionId;
  }
}

/** Session input violates store invariants (blank title, oversize content). */
export class SessionValidationError extends Error {
  constructor(reason: string) {
    super(`Invalid session input: ${reason}`);
    this.name = "SessionValidationError";
  }
}

/** Construction ports shared by every SessionStore implementation. */
export interface SessionStoreDeps {
  idGenerator: IdGenerator;
  clock: Clock;
}

/**
 * Durable execution-session lifecycle contract.
 *
 * Ordering: list newest-first; entry seqs dense per session starting at 0.
 * Errors: unknown ids raise SessionNotFoundError; invalid input raises
 * SessionValidationError. Implementations stamp time and identity from
 * injected Clock/IdGenerator ports (never Date.now/random inline).
 */
export interface SessionStore {
  /** Creates an active session; blank titles are rejected. */
  create(input: SessionCreateInput): Promise<SessionRecord>;
  /** Returns the record or null when unknown (no throw on read). */
  get(id: string): Promise<SessionRecord | null>;
  /** Marks completed; merges summary/metadata; unknown ids throw. */
  complete(id: string, finish?: SessionFinishInput): Promise<SessionRecord>;
  /** Marks failed with a sanitized reason; unknown ids throw. */
  fail(id: string, reason: string): Promise<SessionRecord>;
  /** Marks cancelled by the requester (abort supersedes failure); unknown ids throw. */
  cancel(id: string, reason?: string): Promise<SessionRecord>;
  /** Appends a milestone entry; unknown sessions throw. */
  appendEntry(sessionId: string, entry: { kind: SessionEntry["kind"]; content: string }): Promise<SessionEntry>;
  /** Newest-first entries for one session; unknown sessions throw. */
  listEntries(sessionId: string, limit?: number): Promise<readonly SessionEntry[]>;
  /**
   * Full spilled text for one entry, or null when the entry has no blob
   * (small entries are inline) or the blob is unavailable. Read path never
   * throws; unknown sessions read as null. Optional so custom implementers
   * keep working; absent reads as no blobs.
   */
  readBlob?(sessionId: string, seq: number): Promise<string | null>;
  /** Newest-first records matching every set filter field. */
  list(filter?: SessionListFilter): Promise<readonly SessionRecord[]>;
  /** Deletes record plus entries; false when unknown (no throw). */
  delete(id: string): Promise<boolean>;
}
