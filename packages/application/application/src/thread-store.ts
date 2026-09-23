/**
 * @file thread-store
 * @description Persistent registry of agent threads (pinned config + transcript + workspace).
 *
 * Responsibilities:
 * - Own thread records: create/get/fork/list/delete with caps
 * - Commit one finished turn atomically (history pair + workspace + turn counter)
 * - Persist through the injected JsonFile port with debounced atomic writes
 * - Recover stale threads: a "running" flag from a previous process resets to idle
 *
 * Mirrors the builder session store's durability model; the transcript is the
 * resume point, so a failed turn is never committed (the caller decides).
 */

import { PipelineConfigSchema, THREAD_MESSAGE_MAX_CHARS, ThreadMessageSchema, toolRoundChars, type Clock, type IdGenerator, type PipelineConfig, type ThreadMessage, type ThreadView } from "@agentprism/contracts";
import type { ToolRound } from "@agentprism/contracts";
import type { JsonFile } from "@agentprism/persistence";
import { z } from "zod";
import { AppError } from "./errors.js";

/**
 * Effective caps for one store instance, injected from settings (env-tuned) so
 * operators can raise them without a code change. The defaults preserve the
 * original lab sizing. The thread ceiling must stay below the workspace
 * registry's capacity — settings enforces MAX_WORKSPACES > MAX_THREADS at load,
 * because every thread can own one pinned workspace and a registry full of
 * pins would starve arena runs of slots.
 */
export interface ThreadStoreCaps {
  maxThreads: number;
  maxHistoryMessages: number;
  maxHistoryChars: number;
}

const DEFAULT_CAPS: ThreadStoreCaps = {
  maxThreads: 24,
  maxHistoryMessages: 60,
  maxHistoryChars: 96_000,
};

/** Debounce window coalescing bursts of writes into one atomic flush. */
const FLUSH_DEBOUNCE_MS = 300;

/** One agent thread (runtime truth). */
export interface ThreadRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  running: boolean;
  turnCount: number;
  /** Workspace segment reused across turns ("" until the first run creates it). */
  workspace: string;
  /** Parent thread id when forked; null for a root thread. */
  forkOf: string | null;
  config: PipelineConfig;
  history: ThreadMessage[];
}

/**
 * Persisted per-thread schema, parameterized by the effective history cap: the
 * read bound keeps 2× headroom over the write cap so modest cap drift between
 * runs loads instead of dropping the thread as corrupt.
 */
function buildPersistedThreadSchema(maxHistoryMessages: number) {
  return z.object({
    id: z.string().min(1),
    title: z.string().max(200),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
    turnCount: z.number().int().min(0).default(0),
    workspace: z.string().default(""),
    forkOf: z.string().nullable().default(null),
    config: PipelineConfigSchema,
    history: z.array(ThreadMessageSchema).max(maxHistoryMessages * 2),
  });
}

type PersistedThread = z.infer<ReturnType<typeof buildPersistedThreadSchema>>;

export interface ThreadStoreDeps {
  file: JsonFile;
  idGenerator: IdGenerator;
  clock: Clock;
  /** Overrides the built-in lab defaults; settings injects the full set. */
  caps?: Partial<ThreadStoreCaps>;
  /** Write-coalescing window in ms (default 300); settings injects the operator value. */
  flushDebounceMs?: number;
}

/** Persistent agent-thread registry (config + transcript + workspace linkage). */
export class FileThreadStore {
  private readonly threads = new Map<string, ThreadRecord>();
  private readonly caps: ThreadStoreCaps;
  private readonly threadSchema: ReturnType<typeof buildPersistedThreadSchema>;
  private readonly fileSchema: z.ZodObject<{ version: z.ZodLiteral<1>; threads: z.ZodArray<ReturnType<typeof buildPersistedThreadSchema>> }>;
  private readonly flushDebounceMs: number;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: ThreadStoreDeps) {
    this.caps = { ...DEFAULT_CAPS, ...deps.caps };
    this.flushDebounceMs = deps.flushDebounceMs ?? FLUSH_DEBOUNCE_MS;
    this.threadSchema = buildPersistedThreadSchema(this.caps.maxHistoryMessages);
    this.fileSchema = z.object({
      version: z.literal(1),
      threads: z.array(this.threadSchema),
    });
    this.load();
  }

  /**
   * Loads persisted threads; corrupt records are contained per item.
   *
   * One malformed thread must never wipe the whole registry: valid threads load
   * normally, invalid ones are skipped loudly, and only a file without a threads
   * array starts empty.
   */
  private load(): void {
    let raw: unknown;
    try {
      raw = this.deps.file.read();
    } catch (error) {
      console.warn(`[thread-store] thread file unreadable, starting empty: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (raw === null) return;
    const parsed = this.fileSchema.safeParse(raw);
    if (parsed.success) {
      this.loadItems(parsed.data.threads);
      return;
    }
    if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { threads?: unknown }).threads)) {
      console.warn("[thread-store] thread file schema mismatch, starting empty (thread history is lab state)");
      return;
    }
    const threads = (raw as { threads: unknown[] }).threads;
    let dropped = 0;
    const kept: PersistedThread[] = [];
    for (const item of threads) {
      const single = this.threadSchema.safeParse(item);
      if (!single.success) {
        dropped += 1;
        continue;
      }
      kept.push(single.data);
    }
    console.warn(`[thread-store] thread file partially corrupt: kept ${kept.length}, dropped ${dropped}`);
    if (kept.length === 0) return;
    this.loadItems(kept);
  }

  /** Stores validated items with read-side caps and stale-running reset. */
  private loadItems(items: readonly PersistedThread[]): void {
    const capped = items.slice(0, this.caps.maxThreads);
    if (capped.length < items.length) {
      console.warn(`[thread-store] thread file holds ${items.length} threads; loading the first ${this.caps.maxThreads}`);
    }
    for (const item of capped) {
      // A "running" flag from a previous process is stale by definition: this
      // process owns execution state now, so the thread is resumable again.
      this.threads.set(item.id, {
        id: item.id,
        title: item.title,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        running: false,
        turnCount: item.turnCount,
        workspace: item.workspace,
        forkOf: item.forkOf,
        config: item.config,
        history: item.history,
      });
    }
  }

  /** Creates a root thread; rejects when the registry is full (explicit, no silent eviction). */
  create(title: string, config: PipelineConfig): ThreadRecord {
    if (this.threads.size >= this.caps.maxThreads) {
      throw AppError.conflict(`Thread registry is full (${this.caps.maxThreads}); delete a thread first`);
    }
    const now = this.deps.clock.now();
    const record: ThreadRecord = {
      id: this.deps.idGenerator.next(),
      title: title.trim() === "" ? `Thread ${now.toString(36)}` : title.trim(),
      createdAt: now,
      updatedAt: now,
      running: false,
      turnCount: 0,
      workspace: "",
      forkOf: null,
      config,
      history: [],
    };
    this.threads.set(record.id, record);
    this.scheduleFlush();
    return record;
  }

  /** Gets a thread or throws 404. */
  get(id: string): ThreadRecord {
    const record = this.threads.get(id);
    if (record === undefined) {
      throw AppError.notFound(`Thread "${id}" does not exist`);
    }
    return record;
  }

  /** Lists threads oldest-first. */
  list(): ThreadRecord[] {
    return [...this.threads.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Deletes a thread; refuses while a turn is running. */
  delete(id: string): ThreadRecord {
    const record = this.get(id);
    if (record.running) {
      throw AppError.conflict("Cannot delete a thread while a turn is running");
    }
    this.threads.delete(id);
    this.scheduleFlush();
    return record;
  }

  /** Marks the execution state mirrored in views; the caller owns conflict guards. */
  markRunning(id: string, running: boolean): void {
    const record = this.get(id);
    record.running = running;
  }

  /**
   * Creates a fork of the given parent: copied config and transcript, `forkOf`
   * linkage, no workspace yet (the service branches the directory and calls
   * setWorkspace). The parent is untouched.
   */
  fork(parentId: string, title: string): ThreadRecord {
    const parent = this.get(parentId);
    if (this.threads.size >= this.caps.maxThreads) {
      throw AppError.conflict(`Thread registry is full (${this.caps.maxThreads}); delete a thread first`);
    }
    const now = this.deps.clock.now();
    const record: ThreadRecord = {
      id: this.deps.idGenerator.next(),
      title: title.trim() === "" ? `${parent.title} (fork)` : title.trim(),
      createdAt: now,
      updatedAt: now,
      running: false,
      turnCount: parent.turnCount,
      workspace: "",
      forkOf: parent.id,
      config: structuredClone(parent.config),
      history: parent.history.map((message) => ({ ...message })),
    };
    this.threads.set(record.id, record);
    this.scheduleFlush();
    return record;
  }

  /** Persists the workspace linkage (used after the service branches the directory). */
  setWorkspace(id: string, workspace: string): void {
    const record = this.get(id);
    record.workspace = workspace;
    record.updatedAt = this.deps.clock.now();
    this.scheduleFlush();
  }

  /**
   * Commits one finished turn atomically: history pair + workspace + counter.
   * Called only on success — a failed turn leaves the transcript untouched so
   * the next run resumes from the last committed point.
   *
   * Turn text is sanitized to persistable content before the write: an empty
   * or over-long value becomes a placeholder, because a history entry that
   * fails the persisted schema on reload would drop the WHOLE thread
   * (per-item corruption containment). Write-time validity = read-time validity.
   * The turn's captured tool rounds ride on the assistant half; rendering them
   * is the execution boundary's decision (history_mode), not the store's.
   */
  appendTurn(id: string, question: string, answer: string, workspace: string, toolRounds?: ToolRound[]): void {
    const record = this.get(id);
    record.history = trimToCaps(
      [
        ...record.history,
        { role: "user", content: sanitizedTurnContent(question, "(no question recorded)") },
        {
          role: "assistant",
          content: sanitizedTurnContent(answer, "(no answer extracted)"),
          ...(toolRounds !== undefined && toolRounds.length > 0 ? { tool_rounds: toolRounds } : {}),
        },
      ],
      this.caps,
    );
    if (workspace !== "") record.workspace = workspace;
    record.turnCount += 1;
    record.updatedAt = this.deps.clock.now();
    this.scheduleFlush();
  }

  /** Wire view without the transcript. */
  view(record: ThreadRecord): ThreadView {
    return {
      id: record.id,
      title: record.title,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      running: record.running,
      turn_count: record.turnCount,
      workspace: record.workspace,
      fork_of: record.forkOf,
      config: record.config,
    };
  }

  /** Awaits the pending flush (shutdown paths that want durability). */
  async flushNow(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.writeSnapshot();
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.writeSnapshot();
    }, this.flushDebounceMs);
    this.flushTimer.unref?.();
  }

  private async writeSnapshot(): Promise<void> {
    const payload = {
      version: 1 as const,
      threads: [...this.threads.values()].map((record) => ({
        id: record.id,
        title: record.title,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        turnCount: record.turnCount,
        workspace: record.workspace,
        forkOf: record.forkOf,
        config: record.config,
        history: record.history,
      })),
    };
    try {
      await this.deps.file.write(payload);
    } catch (error) {
      // In-memory state stays authoritative; persistence loss is logged, never thrown into a turn.
      console.warn(`[thread-store] thread flush failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Trims the oldest pairs until both caps hold (history stays user/assistant
 * alternating). Message weight counts captured tool rounds the same way the
 * wire contract measures them, so full-mode rounds cannot silently inflate the
 * transcript past the char cap.
 */
function trimToCaps(history: ThreadMessage[], caps: ThreadStoreCaps): ThreadMessage[] {
  const weights = history.map(
    (message) =>
      message.content.length +
      (message.tool_rounds ?? []).reduce((sum, round) => sum + toolRoundChars(round), 0),
  );
  let start = 0;
  let total = weights.reduce((sum, weight) => sum + weight, 0);
  while (history.length - start > 0 && (history.length - start > caps.maxHistoryMessages || total > caps.maxHistoryChars)) {
    total -= (weights[start] ?? 0) + (weights[start + 1] ?? 0);
    start += 2;
  }
  return history.slice(start);
}

/**
 * Guarantees a turn half survives the persisted schema round-trip: empty
 * (or whitespace-only) text becomes the role-appropriate placeholder, and
 * over-long text is clamped. Without this, one degenerate answer would make
 * the whole thread fail `PersistedThreadSchema` on reload and be dropped.
 */
function sanitizedTurnContent(raw: string, emptyPlaceholder: string): string {
  if (raw.trim() === "") return emptyPlaceholder;
  if (raw.length > THREAD_MESSAGE_MAX_CHARS) return raw.slice(0, THREAD_MESSAGE_MAX_CHARS);
  return raw;
}
