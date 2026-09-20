/**
 * @file jsonl-session-store
 * @description Append-only JSONL session store with snapshots and compaction.
 *
 * Responsibilities:
 * - Implement the SessionStore port over an op log plus whole-state snapshots
 * - Replay the log on load with per-line containment (corrupt lines counted)
 * - Compact the log into a snapshot on demand
 *
 * Mutation semantics mirror FileSessionStore exactly (caps, sanitization,
 * stale-active migration, newest-first ordering): the two backends differ
 * only in durability mechanics — O(1) appends plus periodic snapshots versus
 * whole-file rewrites per mutation. Long-lived sessions with heavy milestone
 * traffic belong here; short runs stay on the single-doc backend.
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
} from "@agentprism/contracts";
import type { AppendFile, JsonFile } from "@agentprism/persistence";
import {
  InMemoryBlobStore,
  MAX_ENTRIES_PER_SESSION,
  MAX_SESSION_TITLE_CHARS,
  MAX_SESSIONS_PER_STORE,
  MAX_SUMMARY_CHARS,
  spillOversizedEntry,
} from "@agentprism/session";
import { PersistedFileSchema, type PersistedSessionItem } from "./file-session-store.js";

/** Op-log line variants (discriminated by `op`). */
type SessionOp =
  | { op: "create"; id: string; kind: SessionRecord["kind"]; title: string; metadata: SessionRecord["metadata"]; at: number }
  | { op: "entry"; sessionId: string; seq: number; at: number; kind: SessionEntry["kind"]; content: string }
  | { op: "complete"; id: string; at: number; summary: string | null; metadata: SessionRecord["metadata"] }
  | { op: "fail"; id: string; at: number; reason: string }
  | { op: "cancel"; id: string; at: number; reason: string }
  | { op: "delete"; id: string; at: number };

/** JsonlSessionStore construction ports (log + snapshot files, id/clock). */
export interface JsonlSessionStoreDeps {
  log: AppendFile;
  snapshot: JsonFile;
  idGenerator: IdGenerator;
  clock: Clock;
  /** Blob sidecar for oversized entries; defaults to ephemeral memory (tests, tooling). */
  blobs?: SessionBlobStore;
}

/**
 * Append-only JSONL SessionStore with snapshot compaction.
 *
 * Crash posture: every mutation appends exactly one line after applying
 * in-memory state, so a torn tail loses at most the in-flight mutation;
 * corrupt log lines are skipped loudly (see `corruptLines`). Snapshots bound
 * replay cost; `checkpoint()` rewrites both files from live state.
 */
export class JsonlSessionStore implements SessionStore {
  private readonly log: AppendFile;
  private readonly snapshot: JsonFile;
  private readonly idGenerator: IdGenerator;
  private readonly clock: Clock;
  private readonly records = new Map<string, SessionRecord>();
  private readonly entries = new Map<string, SessionEntry[]>();
  private readonly blobs: SessionBlobStore;
  private corrupt = 0;
  private loaded = false;

  constructor(deps: JsonlSessionStoreDeps) {
    this.log = deps.log;
    this.snapshot = deps.snapshot;
    this.idGenerator = deps.idGenerator;
    this.clock = deps.clock;
    this.blobs = deps.blobs ?? new InMemoryBlobStore();
  }

  /** Corrupt log lines skipped during the last load (0 when clean). */
  corruptLines(): number {
    return this.corrupt;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      this.loaded = true;
      await this.load();
    }
  }

  /** Creates an active session; rejects blank titles and a full store. */
  async create(input: SessionCreateInput): Promise<SessionRecord> {
    await this.ensureLoaded();
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
    await this.append({ op: "create", id: record.id, kind: record.kind, title: record.title, metadata: record.metadata, at: now });
    return { ...record };
  }

  /** Returns the record or null when unknown (read path never throws). */
  async get(id: string): Promise<SessionRecord | null> {
    await this.ensureLoaded();
    const record = this.records.get(id);
    return record === undefined ? null : { ...record };
  }

  /** Marks completed, merging summary/metadata (unknown ids throw). */
  async complete(id: string, finish: SessionFinishInput = {}): Promise<SessionRecord> {
    await this.ensureLoaded();
    const record = this.require(id);
    const summary = finish.summary?.trim() ?? "";
    record.status = "completed";
    record.updatedAt = this.clock.now();
    if (summary !== "") record.summary = summary.slice(0, MAX_SUMMARY_CHARS);
    Object.assign(record.metadata, finish.metadata ?? {});
    await this.append({
      op: "complete",
      id,
      at: record.updatedAt,
      summary: record.summary,
      metadata: { ...record.metadata },
    });
    return { ...record };
  }

  /** Marks failed with the caller reason (unknown ids throw). */
  async fail(id: string, reason: string): Promise<SessionRecord> {
    await this.ensureLoaded();
    const record = this.require(id);
    record.status = "failed";
    record.updatedAt = this.clock.now();
    record.summary = reason.trim().slice(0, MAX_SUMMARY_CHARS);
    await this.append({ op: "fail", id, at: record.updatedAt, reason: record.summary });
    return { ...record };
  }

  /** Marks cancelled by the requester (abort supersedes failure). */
  async cancel(id: string, reason = "cancelled by client"): Promise<SessionRecord> {
    await this.ensureLoaded();
    const record = this.require(id);
    record.status = "cancelled";
    record.updatedAt = this.clock.now();
    record.summary = reason.trim().slice(0, MAX_SUMMARY_CHARS);
    await this.append({ op: "cancel", id, at: record.updatedAt, reason: record.summary });
    return { ...record };
  }

  /** Appends a milestone entry; rejects empty content and a full session. */
  async appendEntry(
    sessionId: string,
    entry: { kind: SessionEntry["kind"]; content: string },
  ): Promise<SessionEntry> {
    await this.ensureLoaded();
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
    await this.append({ op: "entry", sessionId, seq: stored.seq, at: stored.at, kind: stored.kind, content: stored.content });
    return { ...stored };
  }

  /** Newest-first entries for one session (unknown sessions throw). */
  async listEntries(sessionId: string, limit?: number): Promise<readonly SessionEntry[]> {
    await this.ensureLoaded();
    this.require(sessionId);
    const list = [...(this.entries.get(sessionId) ?? [])].reverse();
    const capped = limit === undefined ? list : list.slice(0, Math.max(0, limit));
    return capped.map((entry) => ({ ...entry }));
  }

  /** Newest-first records matching every set filter field. */
  async list(filter: SessionListFilter = {}): Promise<readonly SessionRecord[]> {
    await this.ensureLoaded();
    const limit = filter.limit ?? MAX_SESSIONS_PER_STORE;
    return [...this.records.values()].reverse()
      .filter((r) => (filter.kind === undefined || r.kind === filter.kind) && (filter.status === undefined || r.status === filter.status))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(0, limit))
      .map((r) => ({ ...r }));
  }

  /** Deletes record plus entries; false when unknown (logs the delete). */
  async delete(id: string): Promise<boolean> {
    await this.ensureLoaded();
    const existed = this.records.delete(id);
    this.entries.delete(id);
    if (existed) {
      try {
        await this.blobs.deleteSessionBlobs(id);
      } catch (error) {
        console.warn(`[jsonl-session-store] blob purge failed for ${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
      await this.append({ op: "delete", id, at: this.clock.now() });
    }
    return existed;
  }

  /** Full spilled text for one entry; null when inline or unavailable (read path never throws). */
  async readBlob(sessionId: string, seq: number): Promise<string | null> {
    await this.ensureLoaded();
    if (!this.records.has(sessionId)) return null;
    try {
      return await this.blobs.loadBlob(sessionId, seq);
    } catch {
      return null;
    }
  }

  /**
   * Rewrites the snapshot from live state and truncates the log.
   * Crash-safe order: snapshot first, log second (replay is idempotent, so a
   * crash between the two only replays already-snapshotted ops).
   */
  async checkpoint(): Promise<{ sessions: number; entries: number }> {
    await this.ensureLoaded();
    const sessions = [...this.records.entries()].map(([id, record]) => ({
      record: { ...record },
      entries: [...(this.entries.get(id) ?? [])],
    }));
    await this.snapshot.write({ version: 1 as const, sessions });
    await this.log.rewrite([]);
    return {
      sessions: sessions.length,
      entries: sessions.reduce((sum, item) => sum + item.entries.length, 0),
    };
  }

  private require(id: string): SessionRecord {
    const record = this.records.get(id);
    if (record === undefined) throw new SessionNotFoundError(id);
    return record;
  }

  private async append(op: SessionOp): Promise<void> {
    await this.log.append([JSON.stringify(op)]);
  }

  /**
   * Loads snapshot then replays the tail: snapshot items load with the same
   * per-item containment and stale-active migration as the single-doc backend;
   * corrupt log lines are skipped loudly and counted (see `corruptLines`).
   */
  private async load(): Promise<void> {
    let raw: unknown = null;
    try {
      raw = this.snapshot.read();
    } catch (error) {
      console.warn(`[jsonl-session-store] snapshot unreadable, replaying log only: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (raw !== null) {
      const parsed = PersistedFileSchema.safeParse(raw);
      if (parsed.success) {
        this.loadItems(parsed.data.sessions);
      } else {
        console.warn("[jsonl-session-store] snapshot schema mismatch, replaying log only");
      }
    }
    let lines: string[] = [];
    try {
      lines = await this.log.readLines();
    } catch (error) {
      console.warn(`[jsonl-session-store] log unreadable, snapshot state only: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    for (const line of lines) {
      if (line.trim() === "") continue;
      let op: SessionOp;
      try {
        op = JSON.parse(line) as SessionOp;
      } catch {
        this.corrupt += 1;
        continue;
      }
      if (!this.applyOp(op)) this.corrupt += 1;
    }
    if (this.corrupt > 0) {
      console.warn(`[jsonl-session-store] skipped ${this.corrupt} corrupt log lines`);
    }
  }

  /** Applies one replayed op; false when the op is malformed or inapplicable. */
  private applyOp(op: SessionOp): boolean {
    if (op === null || typeof op !== "object" || typeof op.op !== "string") return false;
    if (op.op === "create") {
      if (typeof op.id !== "string" || op.id === "") return false;
      if (this.records.size >= MAX_SESSIONS_PER_STORE) return false;
      // Replay-only path: a create op on disk belongs to a previous process,
      // so the run is stale and lands failed (live create() sets active above).
      this.records.set(op.id, {
        id: op.id,
        kind: op.kind === "arena" || op.kind === "agent" || op.kind === "builder" ? op.kind : "agent",
        title: typeof op.title === "string" ? op.title : "(untitled)",
        status: "failed",
        createdAt: op.at,
        updatedAt: op.at,
        summary: null,
        metadata: { ...(op.metadata ?? {}) },
        entryCount: 0,
      });
      this.entries.set(op.id, []);
      return true;
    }
    if (op.op === "entry") {
      const record = this.records.get(op.sessionId);
      const list = this.entries.get(op.sessionId) ?? [];
      if (record === undefined || list.length >= MAX_ENTRIES_PER_SESSION) return false;
      // Out-of-order or duplicate seqs heal by position (replay order is truth).
      list.push({
        sessionId: op.sessionId,
        seq: list.length,
        at: op.at,
        kind: op.kind === "verdict" || op.kind === "note" ? op.kind : "lifecycle",
        content: typeof op.content === "string" ? op.content : "",
      });
      this.entries.set(op.sessionId, list);
      record.entryCount = list.length;
      record.updatedAt = op.at;
      return true;
    }
    if (op.op === "complete" || op.op === "fail" || op.op === "cancel") {
      const record = this.records.get(op.id);
      if (record === undefined) return false;
      record.status = op.op === "complete" ? "completed" : op.op === "fail" ? "failed" : "cancelled";
      record.updatedAt = op.at;
      if (op.op === "complete") {
        if (typeof op.summary === "string" && op.summary !== "") record.summary = op.summary;
        Object.assign(record.metadata, op.metadata ?? {});
      } else {
        record.summary = typeof op.reason === "string" ? op.reason : "";
      }
      return true;
    }
    if (op.op === "delete") {
      this.records.delete(op.id);
      this.entries.delete(op.id);
      return true;
    }
    return false;
  }

  /** Loads snapshot items with read-side caps and stale-active migration. */
  private loadItems(items: readonly PersistedSessionItem[]): void {
    const capped = items.slice(0, MAX_SESSIONS_PER_STORE);
    for (const item of capped) {
      const record: SessionRecord = { ...item.record };
      if (record.status === "active") record.status = "failed";
      const entries = item.entries
        .filter((e) => e.sessionId === record.id)
        .slice(0, MAX_ENTRIES_PER_SESSION)
        .map((e, index) => ({ ...e, seq: index }));
      this.records.set(record.id, { ...record, entryCount: entries.length });
      this.entries.set(record.id, entries);
    }
  }
}
