/**
 * @file file-session-store
 * @description File-backed SessionStore: durable sessions in one JSON document.
 *
 * Responsibilities:
 * - Persist session records plus milestone entries through the JsonFile port
 * - Validate on read (schema mismatch starts scoped-empty, never half-loaded)
 *
 * Single-document layout mirrors BuilderSessionStore (whole-file atomic writes
 * with .bak recovery from the persistence layer); entries are milestones, not
 * event streams, so write-through stays cheap without debouncing.
 */

import { z } from "zod";
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
import type { JsonFile } from "@agentprism/persistence";
import {
  InMemoryBlobStore,
  MAX_ENTRIES_PER_SESSION,
  MAX_ENTRY_CONTENT_CHARS,
  MAX_SESSION_TITLE_CHARS,
  MAX_SESSIONS_PER_STORE,
  MAX_SUMMARY_CHARS,
  spillOversizedEntry,
} from "@agentprism/session";

/** Session kind enum for persisted documents (shared with the JSONL snapshot path). */
export const SessionKindSchema = z.enum(["arena", "agent", "builder"]);
const SessionStatusSchema = z.enum(["active", "completed", "failed", "cancelled"]);

const SessionRecordSchema = z.object({
  id: z.string().min(1),
  kind: SessionKindSchema,
  title: z.string().max(MAX_SESSION_TITLE_CHARS),
  status: SessionStatusSchema,
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  summary: z.string().max(MAX_SUMMARY_CHARS).nullable(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  entryCount: z.number().int().min(0),
});

const SessionEntrySchema = z.object({
  sessionId: z.string().min(1),
  seq: z.number().int().min(0),
  at: z.number().int(),
  kind: z.enum(["lifecycle", "verdict", "note"]),
  content: z.string().max(MAX_ENTRY_CONTENT_CHARS),
});

/** One persisted session item (shared with the JSONL snapshot path). */
export const PersistedSessionItemSchema = z.object({
  record: SessionRecordSchema,
  entries: z.array(SessionEntrySchema),
});
export type PersistedSessionItem = z.infer<typeof PersistedSessionItemSchema>;

/** Whole-state snapshot shape (shared with the JSONL snapshot path). */
export const PersistedFileSchema = z.object({
  version: z.literal(1),
  sessions: z.array(PersistedSessionItemSchema),
});

/** FileSessionStore construction ports (JsonFile keeps business code off disk IO). */
export interface FileSessionStoreDeps {
  file: JsonFile;
  idGenerator: IdGenerator;
  clock: Clock;
  /** Blob sidecar for oversized entries; defaults to ephemeral memory (tests, tooling). */
  blobs?: SessionBlobStore;
}

/** File-backed SessionStore: one versioned JSON document, atomic whole-file writes.
 *
 * Method contracts live on the SessionStore port; notes below cover only what
 * differs here: every mutation flushes through, stale active rows land failed
 * on load, and corrupt records are contained per item (see loadItems). */
export class FileSessionStore implements SessionStore {
  private readonly file: JsonFile;
  private readonly idGenerator: IdGenerator;
  private readonly clock: Clock;
  private readonly records = new Map<string, SessionRecord>();
  private readonly entries = new Map<string, SessionEntry[]>();
  private readonly blobs: SessionBlobStore;

  constructor(deps: FileSessionStoreDeps) {
    this.file = deps.file;
    this.idGenerator = deps.idGenerator;
    this.clock = deps.clock;
    this.blobs = deps.blobs ?? new InMemoryBlobStore();
    this.load();
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
    await this.flush();
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
    await this.flush();
    return { ...record };
  }

  /** Marks failed with the caller-sanitized reason (unknown ids throw). */
  async fail(id: string, reason: string): Promise<SessionRecord> {
    const record = this.require(id);
    record.status = "failed";
    record.updatedAt = this.clock.now();
    record.summary = reason.trim().slice(0, MAX_SUMMARY_CHARS);
    await this.flush();
    return { ...record };
  }

  /** Marks cancelled by the requester (abort supersedes failure). */
  async cancel(id: string, reason = "cancelled by client"): Promise<SessionRecord> {
    const record = this.require(id);
    record.status = "cancelled";
    record.updatedAt = this.clock.now();
    record.summary = reason.trim().slice(0, MAX_SUMMARY_CHARS);
    await this.flush();
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
    await this.flush();
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
    if (existed) {
      try {
        await this.blobs.deleteSessionBlobs(id);
      } catch (error) {
        console.warn(`[session-store] blob purge failed for ${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
      await this.flush();
    }
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

  /**
   * Loads persisted sessions; corrupt records are contained per item.
   *
   * A single malformed session must never wipe the whole ledger (the prior
   * whole-file safeParse did exactly that, forcing operators to start over).
   * Valid items load normally; invalid items are skipped loudly. Only a file
   * without a sessions array starts empty.
   */
  private load(): void {
    let raw: unknown;
    try {
      raw = this.file.read();
    } catch (error) {
      console.warn(`[session-store] session file unreadable, starting empty: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (raw === null) return;
    const parsed = PersistedFileSchema.safeParse(raw);
    if (parsed.success) {
      this.loadItems(parsed.data.sessions);
      return;
    }
    // Tolerant fallback: keep every well-formed session even when siblings are corrupt.
    if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { sessions?: unknown }).sessions)) {
      console.warn("[session-store] session file schema mismatch, starting empty");
      return;
    }
    const sessions = (raw as { sessions: unknown[] }).sessions;
    let dropped = 0;
    const kept: { record: SessionRecord; entries: SessionEntry[] }[] = [];
    for (const item of sessions) {
      const single = PersistedSessionItemSchema.safeParse(item);
      if (!single.success) {
        dropped += 1;
        continue;
      }
      kept.push({ record: { ...single.data.record }, entries: [...single.data.entries] });
    }
    console.warn(`[session-store] session file partially corrupt: kept ${kept.length}, dropped ${dropped}`);
    if (kept.length === 0) return;
    this.loadItems(kept);
  }

  /** Stores validated items with read-side caps and stale-active migration. */
  private loadItems(items: readonly { record: SessionRecord; entries: SessionEntry[] }[]): void {
    // Truncate on the read side so a hand-grown file cannot exhaust memory.
    const capped = items.slice(0, MAX_SESSIONS_PER_STORE);
    if (capped.length < items.length) {
      console.warn(`[session-store] session file holds ${items.length} sessions; loading the first ${MAX_SESSIONS_PER_STORE}`);
    }
    for (const item of capped) {
      // A stale "active" flag from a previous process can never resume here:
      // this process owns execution state now, so inherited runs land failed.
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

  private async flush(): Promise<void> {
    const sessions = [...this.records.entries()].map(([id, record]) => ({
      record: { ...record },
      entries: [...(this.entries.get(id) ?? [])],
    }));
    await this.file.write({ version: 1 as const, sessions });
  }

  private require(id: string): SessionRecord {
    const record = this.records.get(id);
    if (record === undefined) throw new SessionNotFoundError(id);
    return record;
  }
}
