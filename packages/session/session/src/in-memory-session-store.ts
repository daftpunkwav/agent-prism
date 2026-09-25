/**
 * @file memory-store
 * @description In-memory SessionStore: ephemeral sessions for tests and tooling.
 *
 * Responsibilities:
 * - Implement the full SessionStore contract without any IO
 *
 * Validation mirrors the file implementation (blank titles, oversize content,
 * entry/list caps) so contract tests catch drift between backends.
 */

import {
  SessionNotFoundError,
  SessionValidationError,
  type Clock,
  type IdGenerator,
  type SessionBlobStore,
  type SessionCreateInput,
  type SessionEntry,
  type SessionFinishInput,
  type SessionListFilter,
  type SessionRecord,
  type SessionStore,
  type SessionStoreDeps,
} from "@agentprism/contracts";
import { InMemoryBlobStore, spillOversizedEntry } from "./blob-store.js";

/** Defensive caps shared with the file backend (see session-persistence). */
export const MAX_SESSION_TITLE_CHARS = 120;
export const MAX_SESSIONS_PER_STORE = 200;
export const MAX_ENTRIES_PER_SESSION = 500;
export const MAX_ENTRY_CONTENT_CHARS = 8_000;
export const MAX_SUMMARY_CHARS = 2_000;

/** In-memory SessionStore: no IO, same validation as durable backends. */
export class InMemorySessionStore implements SessionStore {
  private readonly idGenerator: IdGenerator;
  private readonly clock: Clock;
  private readonly records = new Map<string, SessionRecord>();
  private readonly entries = new Map<string, SessionEntry[]>();
  private readonly blobs: SessionBlobStore;

  constructor(deps: SessionStoreDeps & { blobs?: SessionBlobStore }) {
    this.idGenerator = deps.idGenerator;
    this.clock = deps.clock;
    this.blobs = deps.blobs ?? new InMemoryBlobStore();
  }

  /** Creates an active session; rejects blank titles and a full store (contract: SessionStore). */
  async create(input: SessionCreateInput): Promise<SessionRecord> {
    const title = input.title.trim();
    if (title === "") throw new SessionValidationError("title must be non-empty");
    if (this.records.size >= MAX_SESSIONS_PER_STORE) {
      throw new SessionValidationError(`store holds the cap of ${MAX_SESSIONS_PER_STORE} sessions`);
    }
    const now = this.clock.now();
    const record: SessionRecord = {
      id: this.idGenerator.next(),
      kind: input.kind,
      title: title.slice(0, MAX_SESSION_TITLE_CHARS),
      status: "active",
      createdAt: now,
      updatedAt: now,
      summary: null,
      metadata: { ...(input.metadata ?? {}) },
      entryCount: 0,
    };
    this.records.set(record.id, record);
    this.entries.set(record.id, []);
    return { ...record };
  }

  /** Returns the record or null when unknown (read path never throws). */
  async get(id: string): Promise<SessionRecord | null> {
    const record = this.records.get(id);
    return record === undefined ? null : { ...record };
  }

  /** Marks completed, merging summary/metadata (unknown ids throw). */
  async complete(id: string, finish: SessionFinishInput = {}): Promise<SessionRecord> {
    const record = this.require(id);
    const summary = finish.summary?.trim() ?? "";
    record.status = "completed";
    record.updatedAt = this.clock.now();
    if (summary !== "") record.summary = summary.slice(0, MAX_SUMMARY_CHARS);
    Object.assign(record.metadata, finish.metadata ?? {});
    return { ...record };
  }

  /** Marks failed with the caller-sanitized reason (unknown ids throw). */
  async fail(id: string, reason: string): Promise<SessionRecord> {
    const record = this.require(id);
    record.status = "failed";
    record.updatedAt = this.clock.now();
    record.summary = reason.trim().slice(0, MAX_SUMMARY_CHARS);
    return { ...record };
  }

  /** Marks cancelled by the requester (abort supersedes failure). */
  async cancel(id: string, reason = "cancelled by client"): Promise<SessionRecord> {
    const record = this.require(id);
    record.status = "cancelled";
    record.updatedAt = this.clock.now();
    record.summary = reason.trim().slice(0, MAX_SUMMARY_CHARS);
    return { ...record };
  }

  /** Appends a milestone entry; rejects empty content and a full session. */
  async appendEntry(
    sessionId: string,
    entry: { kind: SessionEntry["kind"]; content: string },
  ): Promise<SessionEntry> {
    const record = this.require(sessionId);
    const content = entry.content.trim();
    if (content === "") throw new SessionValidationError("entry content must be non-empty");
    const list = this.entries.get(sessionId) ?? [];
    if (list.length >= MAX_ENTRIES_PER_SESSION) {
      throw new SessionValidationError(`session holds the cap of ${MAX_ENTRIES_PER_SESSION} entries`);
    }
    const stored: SessionEntry = {
      sessionId,
      seq: list.length,
      at: this.clock.now(),
      kind: entry.kind,
      content: await spillOversizedEntry(this.blobs, sessionId, list.length, content),
    };
    list.push(stored);
    this.entries.set(sessionId, list);
    record.entryCount = list.length;
    record.updatedAt = stored.at;
    return { ...stored };
  }

  /** Newest-first entries for one session (unknown sessions throw). */
  async listEntries(sessionId: string, limit?: number): Promise<readonly SessionEntry[]> {
    this.require(sessionId);
    const list = [...(this.entries.get(sessionId) ?? [])].reverse();
    const capped = limit === undefined ? list : list.slice(0, Math.max(0, limit));
    return capped.map((entry) => ({ ...entry }));
  }

  /** Newest-first records matching every set filter field. */
  async list(filter: SessionListFilter = {}): Promise<readonly SessionRecord[]> {
    const limit = filter.limit ?? MAX_SESSIONS_PER_STORE;
    // Reverse insertion order first: the stable sort keeps newest-inserted first on timestamp ties.
    return [...this.records.values()].reverse()
      .filter((r) => (filter.kind === undefined || r.kind === filter.kind) && (filter.status === undefined || r.status === filter.status))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(0, limit))
      .map((r) => ({ ...r }));
  }

  /** Deletes record plus entries; false when unknown (no throw). */
  async delete(id: string): Promise<boolean> {
    const existed = this.records.delete(id);
    this.entries.delete(id);
    if (existed) await this.blobs.deleteSessionBlobs(id);
    return existed;
  }

  /** Full spilled text for one entry; null when inline or unavailable (read path never throws). */
  async readBlob(sessionId: string, seq: number): Promise<string | null> {
    if (!this.records.has(sessionId)) return null;
    try {
      return await this.blobs.loadBlob(sessionId, seq);
    } catch {
      return null;
    }
  }

  private require(id: string): SessionRecord {
    const record = this.records.get(id);
    if (record === undefined) throw new SessionNotFoundError(id);
    return record;
  }
}
