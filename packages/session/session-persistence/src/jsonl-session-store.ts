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
import { SerialQueue, type AppendFile, type JsonFile } from "@agentprism/persistence";
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

/** Default appended-bytes budget between automatic checkpoints (see deps.checkpointBytes). */
export const DEFAULT_CHECKPOINT_BYTES = 32 * 1024 * 1024;

/** JsonlSessionStore construction ports (log + snapshot files, id/clock). */
export interface JsonlSessionStoreDeps {
  log: AppendFile;
  snapshot: JsonFile;
  idGenerator: IdGenerator;
  clock: Clock;
  /** Blob sidecar for oversized entries; defaults to ephemeral memory (tests, tooling). */
  blobs?: SessionBlobStore;
  /**
   * Appended-bytes budget between automatic checkpoints (default 32MB). A
   * session writing heavily must not grow the log without bound between the
   * host's checkpoint cadence; at the budget the store compacts on its own,
   * which also bounds the whole-file replay memory on the next boot.
   */
  checkpointBytes?: number;
}

/**
 * Mutation key: one queue per store, because `checkpoint()` must not interleave with
 * a mutation (see the `mutations` field).
 */
const STORE_MUTATION_KEY = "store";

/** Identity for a seq-less replay match. Content is included so two notes at one timestamp stay distinct. */
function entryIdentity(sessionId: string, at: number, kind: string, content: string): string {
  return `${sessionId}\0${at}\0${kind}\0${content}`;
}

/**
 * Append-only JSONL SessionStore with snapshot compaction.
 *
 * Every mutation appends one line instead of rewriting the whole ledger, so an
 * append costs the entry, not the store. Crash posture: a torn tail loses at most
 * the in-flight mutation and corrupt lines are skipped loudly (`corruptLines`).
 * `checkpoint()` rewrites snapshot + log from live state and bounds replay cost;
 * the host calls it on a cadence and on shutdown (see `checkpointStores`), and
 * the store triggers it on its own once the log grows past a size budget.
 */
export class JsonlSessionStore implements SessionStore {
  private readonly log: AppendFile;
  private readonly snapshot: JsonFile;
  private readonly idGenerator: IdGenerator;
  private readonly clock: Clock;
  private readonly records = new Map<string, SessionRecord>();
  private readonly entries = new Map<string, SessionEntry[]>();
  private readonly blobs: SessionBlobStore;
  /**
   * Serializes every state change of this store under one key.
   *
   * Per-session keys would be enough for seq assignment, but `checkpoint()` rewrites
   * the snapshot and truncates the log: a mutation that lands inside that window is
   * applied in memory, then dropped by the truncate, and the caller has already been
   * told it succeeded. One key makes mutations and checkpoint mutually exclusive, at
   * the cost of serializing appends across sessions (they share one log anyway).
   */
  private readonly mutations = new SerialQueue();
  private corrupt = 0;
  private loadPromise: Promise<void> | null = null;
  /** Bytes appended since the last compaction (drives the size-triggered checkpoint). */
  private appendedSinceCheckpoint = 0;
  /** Normalized append budget between automatic checkpoints. */
  private readonly checkpointBytes: number;
  /**
   * Snapshot entry counts keyed by session, timestamp, kind, and content.
   * Seq-less log lines (legacy writers) claim from this baseline during replay
   * so a checkpoint crash does not append them again. Live writes always store seq.
   */
  private readonly baselineEntryCounts = new Map<string, number>();
  /** How many seq-less lines have already claimed each baseline identity. */
  private readonly replayMatched = new Map<string, number>();

  constructor(deps: JsonlSessionStoreDeps) {
    this.log = deps.log;
    this.snapshot = deps.snapshot;
    this.idGenerator = deps.idGenerator;
    this.clock = deps.clock;
    this.blobs = deps.blobs ?? new InMemoryBlobStore();
    this.checkpointBytes =
      deps.checkpointBytes !== undefined && Number.isFinite(deps.checkpointBytes) && deps.checkpointBytes > 0
        ? Math.trunc(deps.checkpointBytes)
        : DEFAULT_CHECKPOINT_BYTES;
  }

  /** Corrupt log lines skipped during the last load (0 when clean). */
  corruptLines(): number {
    return this.corrupt;
  }

  private async ensureLoaded(): Promise<void> {
    // Memoize the PROMISE: a concurrent caller must await the same load instead of
    // reading an empty ledger while the first load is still in flight.
    this.loadPromise ??= this.load();
    await this.loadPromise;
  }

  /** Creates an active session; rejects blank titles and a full store. */
  async create(input: SessionCreateInput): Promise<SessionRecord> {
    await this.ensureLoaded();
    const title = input.title.trim();
    if (title === "") throw new SessionValidationError("title must be non-empty");
    return this.mutations.run(STORE_MUTATION_KEY, async () => {
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
      // Log first: a failed append leaves memory unchanged, and a crash after the
      // line lands is recovered by replay instead of persisting a memory-only write.
      await this.append({ op: "create", id: record.id, kind: record.kind, title: record.title, metadata: record.metadata, at: now });
      this.records.set(record.id, record);
      this.entries.set(record.id, []);
      return { ...record };
    });
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
    return this.mutations.run(STORE_MUTATION_KEY, async () => {
      const record = this.require(id);
      const summary = finish.summary?.trim() ?? "";
      const updatedAt = this.clock.now();
      const nextSummary = summary !== "" ? summary.slice(0, MAX_SUMMARY_CHARS) : record.summary;
      const nextMetadata = { ...record.metadata, ...(finish.metadata ?? {}) };
      await this.append({
        op: "complete",
        id,
        at: updatedAt,
        summary: nextSummary,
        metadata: nextMetadata,
      });
      record.status = "completed";
      record.updatedAt = updatedAt;
      record.summary = nextSummary;
      record.metadata = nextMetadata;
      return { ...record };
    });
  }

  /** Marks failed with the caller reason (unknown ids throw). */
  async fail(id: string, reason: string): Promise<SessionRecord> {
    await this.ensureLoaded();
    return this.mutations.run(STORE_MUTATION_KEY, async () => {
      const record = this.require(id);
      const updatedAt = this.clock.now();
      const summary = reason.trim().slice(0, MAX_SUMMARY_CHARS);
      await this.append({ op: "fail", id, at: updatedAt, reason: summary });
      record.status = "failed";
      record.updatedAt = updatedAt;
      record.summary = summary;
      return { ...record };
    });
  }

  /** Marks cancelled by the requester (abort supersedes failure). */
  async cancel(id: string, reason = "cancelled by client"): Promise<SessionRecord> {
    await this.ensureLoaded();
    return this.mutations.run(STORE_MUTATION_KEY, async () => {
      const record = this.require(id);
      const updatedAt = this.clock.now();
      const summary = reason.trim().slice(0, MAX_SUMMARY_CHARS);
      await this.append({ op: "cancel", id, at: updatedAt, reason: summary });
      record.status = "cancelled";
      record.updatedAt = updatedAt;
      record.summary = summary;
      return { ...record };
    });
  }

  /** Appends a milestone entry; rejects empty content and a full session. */
  async appendEntry(
    sessionId: string,
    entry: { kind: SessionEntry["kind"]; content: string },
  ): Promise<SessionEntry> {
    await this.ensureLoaded();
    // Queued: seq is read before the spill await, so a concurrent append would
    // claim the same seq and overwrite the same blob.
    return this.mutations.run(STORE_MUTATION_KEY, async () => {
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
      await this.append({ op: "entry", sessionId, seq: stored.seq, at: stored.at, kind: stored.kind, content: stored.content });
      list.push(stored);
      this.entries.set(sessionId, list);
      record.entryCount = list.length;
      record.updatedAt = stored.at;
      return { ...stored };
    });
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
    return this.mutations.run(STORE_MUTATION_KEY, async () => {
      if (!this.records.has(id)) return false;
      // The delete line is the durable record. Blobs go after it: a crash in
      // between leaves orphan files, not a session whose body was already erased.
      await this.append({ op: "delete", id, at: this.clock.now() });
      this.records.delete(id);
      this.entries.delete(id);
      try {
        await this.blobs.deleteSessionBlobs(id);
      } catch (error) {
        console.warn(`[jsonl-session-store] blob purge failed for ${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
      return true;
    });
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
    // Queued: building the snapshot, writing it and truncating the log must not
    // interleave with a mutation, or that mutation's log line disappears while its
    // state change was already answered as committed.
    return this.mutations.run(STORE_MUTATION_KEY, async () => {
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
    });
  }

  private require(id: string): SessionRecord {
    const record = this.records.get(id);
    if (record === undefined) throw new SessionNotFoundError(id);
    return record;
  }

  private async append(op: SessionOp): Promise<void> {
    const line = JSON.stringify(op);
    await this.log.append([line]);
    this.appendedSinceCheckpoint += line.length + 1;
    if (this.appendedSinceCheckpoint >= this.checkpointBytes) {
      // The budget resets before the compaction runs: appends landing while the
      // queued checkpoint waits count toward the next window, so a slow
      // checkpoint cannot trigger a back-to-back loop. checkpoint() never
      // appends, so this cannot recurse.
      this.appendedSinceCheckpoint = 0;
      void this.checkpoint().catch((error: unknown) => {
        console.warn(`[jsonl-session-store] size-triggered checkpoint failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
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
    this.captureEntryBaseline();
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
      // The snapshot already holds this session. Applying create again would mark
      // it failed and drop entries the checkpoint had already saved.
      if (this.records.has(op.id)) return true;
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
      const kind = op.kind === "verdict" || op.kind === "note" ? op.kind : "lifecycle";
      const content = typeof op.content === "string" ? op.content : "";
      // A checkpoint writes the snapshot before it truncates the log. An entry
      // whose seq is already in that snapshot must not be appended again.
      // Legacy lines omit seq; they claim one matching snapshot entry instead,
      // so a second identical line is still kept.
      if (typeof op.seq === "number" && op.seq < list.length) return true;
      if (typeof op.seq !== "number" && this.claimBaselineEntry(op.sessionId, op.at, kind, content)) return true;
      list.push({
        sessionId: op.sessionId,
        seq: list.length,
        at: op.at,
        kind,
        content,
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

  /** Counts snapshot entries so seq-less replay can skip copies already stored. */
  private captureEntryBaseline(): void {
    this.baselineEntryCounts.clear();
    this.replayMatched.clear();
    for (const [sessionId, list] of this.entries) {
      for (const entry of list) {
        const key = entryIdentity(sessionId, entry.at, entry.kind, entry.content);
        this.baselineEntryCounts.set(key, (this.baselineEntryCounts.get(key) ?? 0) + 1);
      }
    }
  }

  /** True when this seq-less line corresponds to a snapshot entry not yet claimed. */
  private claimBaselineEntry(sessionId: string, at: number, kind: string, content: string): boolean {
    const key = entryIdentity(sessionId, at, kind, content);
    const baseline = this.baselineEntryCounts.get(key) ?? 0;
    const used = this.replayMatched.get(key) ?? 0;
    if (used >= baseline) return false;
    this.replayMatched.set(key, used + 1);
    return true;
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
