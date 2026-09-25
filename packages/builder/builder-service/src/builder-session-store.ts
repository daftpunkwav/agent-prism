/**
 * @file builder-session-store
 * @description Persistent registry of builder sessions (composition + history).
 *
 * Responsibilities:
 * - Own session records: create/get/list/delete with caps and uniqueness
 * - Commit one turn atomically (history pair + workspace + turn counter)
 * - Persist through the injected JsonFile port with debounced atomic writes
 * - Recover stale sessions: a "running" flag from a previous process resets to idle
 *
 * Persistence here covers composition and history only; pending notices stay
 * runtime-scoped, and the trace journal persists through the injected
 * SessionTraceStore (see trace-store).
 */

import {
  BUILDER_MESSAGE_MAX_CHARS,
  BuilderChatMessageSchema,
  BuilderCompositionSchema,
  migrateLegacyToolNames,
  trimHistoryToCaps,
  type BuilderChatMessage,
  type BuilderComposition,
  type BuilderSessionView,
  type Clock,
  type IdGenerator,
  type ToolRound,
} from "@agentprism/contracts";
import type { JsonFile } from "@agentprism/persistence";
import { z } from "zod";
import { BuilderError } from "@agentprism/builder-turns";

/** Session ceiling: the builder is a local lab tool, not a multi-tenant store. */
const MAX_SESSIONS = 50;

/** History caps (server-side truth; the wire schema caps each message's content). */
const MAX_HISTORY_MESSAGES = 60;
const MAX_HISTORY_CHARS = 96_000;

/** Debounce window coalescing bursts of writes into one atomic flush. */
const FLUSH_DEBOUNCE_MS = 300;

/** Pending-notice ceiling per session (see queueNotice). */
const MAX_PENDING_NOTICES = 20;

/** One builder session (runtime truth). */
export interface BuilderSessionRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  composition: BuilderComposition;
  history: BuilderChatMessage[];
  workspaceName: string;
  turnCount: number;
  running: boolean;
}

const PersistedSessionSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(60),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  composition: BuilderCompositionSchema,
  history: z.array(BuilderChatMessageSchema).max(MAX_HISTORY_MESSAGES),
  workspaceName: z.string().default(""),
  turnCount: z.number().int().min(0).default(0),
});

const PersistedFileSchema = z.object({
  version: z.literal(1),
  sessions: z.array(PersistedSessionSchema),
});

export interface BuilderSessionStoreDeps {
  file: JsonFile;
  idGenerator: IdGenerator;
  clock: Clock;
  /** Write-coalescing window in ms (default 300); settings injects the operator value. */
  flushDebounceMs?: number;
}

/** Persistent builder-session registry (composition + history; notices stay runtime-only). */
export class BuilderSessionStore {
  private readonly sessions = new Map<string, BuilderSessionRecord>();
  private readonly pendingNotices = new Map<string, string[]>();
  private readonly flushDebounceMs: number;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: BuilderSessionStoreDeps) {
    this.flushDebounceMs = deps.flushDebounceMs ?? FLUSH_DEBOUNCE_MS;
    this.load();
  }

  /**
   * Loads persisted sessions; corrupt records are contained per item.
   *
   * One malformed builder session must never wipe the whole registry.
   * Valid sessions load normally; invalid ones are skipped loudly. Only a
   * file without a sessions array starts empty.
   */
  private load(): void {
    let raw: unknown;
    try {
      raw = this.deps.file.read();
    } catch (error) {
      console.warn(`[builder-store] session file unreadable, starting empty: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (raw === null) return;
    const parsed = PersistedFileSchema.safeParse(raw);
    if (parsed.success) {
      this.loadItems(parsed.data.sessions);
      return;
    }
    if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { sessions?: unknown }).sessions)) {
      console.warn("[builder-store] session file schema mismatch, starting empty (run history is lab state)");
      return;
    }
    const sessions = (raw as { sessions: unknown[] }).sessions;
    let dropped = 0;
    const kept: z.infer<typeof PersistedSessionSchema>[] = [];
    for (const item of sessions) {
      const single = PersistedSessionSchema.safeParse(item);
      if (!single.success) {
        dropped += 1;
        continue;
      }
      kept.push(single.data);
    }
    console.warn(`[builder-store] session file partially corrupt: kept ${kept.length}, dropped ${dropped}`);
    if (kept.length === 0) return;
    this.loadItems(kept);
  }

  /** Stores validated items with read-side caps and stale-running reset. */
  private loadItems(items: readonly z.infer<typeof PersistedSessionSchema>[]): void {
    // The session file bypasses the creation path's cap the same way project archives do:
    // truncate on the read side so a hand-grown file cannot exhaust memory.
    const capped = items.slice(0, MAX_SESSIONS);
    if (capped.length < items.length) {
      console.warn(`[builder-store] session file holds ${items.length} sessions; loading the first ${MAX_SESSIONS}`);
    }
    for (const item of capped) {
      // A "running" flag from a previous process is stale by definition: this process owns execution state now.
      this.sessions.set(item.id, {
        id: item.id,
        name: item.name,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        // Persisted compositions may predate the run->bash tool rename.
        composition: { ...item.composition, tools: migrateLegacyToolNames(item.composition.tools) },
        history: item.history,
        workspaceName: item.workspaceName,
        turnCount: item.turnCount,
        running: false,
      });
    }
  }

  /** Creates a session; rejects when the registry is full (explicit, no silent eviction). */
  create(name: string, composition: BuilderComposition): BuilderSessionRecord {
    if (this.sessions.size >= MAX_SESSIONS) {
      throw BuilderError.conflict(`Session registry is full (${MAX_SESSIONS}); delete a session first`);
    }
    const now = this.deps.clock.now();
    const record: BuilderSessionRecord = {
      id: this.deps.idGenerator.next(),
      name: name.trim() === "" ? `Agent ${now.toString(36)}` : name.trim(),
      createdAt: now,
      updatedAt: now,
      composition,
      history: [],
      workspaceName: "",
      turnCount: 0,
      running: false,
    };
    this.sessions.set(record.id, record);
    this.scheduleFlush();
    return record;
  }

  /** Gets a session or throws 404. */
  get(id: string): BuilderSessionRecord {
    const record = this.sessions.get(id);
    if (record === undefined) {
      throw BuilderError.notFound(`Builder session "${id}" does not exist`);
    }
    return record;
  }

  /** Lists sessions oldest-first. */
  list(): BuilderSessionRecord[] {
    return [...this.sessions.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Deletes a session and its queued notices; refuses while a turn is running. */
  delete(id: string): BuilderSessionRecord {
    const record = this.get(id);
    if (record.running) {
      throw BuilderError.conflict("Cannot delete a session while a turn is running");
    }
    this.sessions.delete(id);
    this.pendingNotices.delete(id);
    this.scheduleFlush();
    return record;
  }

  /** Replaces the composition (hot-swap); refuses while a turn is running. */
  updateComposition(id: string, composition: BuilderComposition): BuilderSessionRecord {
    const record = this.get(id);
    if (record.running) {
      throw BuilderError.conflict("Cannot hot-swap blocks while a turn is running");
    }
    record.composition = composition;
    record.updatedAt = this.deps.clock.now();
    this.scheduleFlush();
    return record;
  }

  /** Renames a session display name; legal even mid-turn (pure metadata). */
  rename(id: string, name: string): BuilderSessionRecord {
    const record = this.get(id);
    const trimmed = name.trim();
    record.name = trimmed === "" ? record.name : trimmed.slice(0, 60);
    record.updatedAt = this.deps.clock.now();
    this.scheduleFlush();
    return record;
  }

  /** Marks the execution state mirrored in views; the caller owns conflict guards. */
  markRunning(id: string, running: boolean): void {
    const record = this.get(id);
    record.running = running;
  }

  /**
   * Commits one finished turn atomically: history pair + workspace + counter.
   * Both messages carry the turn number so the client can re-attach each
   * bubble's work trail from the persisted journal after a reload.
   * The turn's captured tool rounds ride on the assistant half; rendering them
   * is the execution boundary's decision (history_mode), not the store's.
   */
  appendTurn(
    id: string,
    userMessage: string,
    assistantAnswer: string,
    workspaceName: string,
    turn?: number,
    toolRounds?: ToolRound[],
  ): void {
    const record = this.get(id);
    record.history = trimToCaps([
      ...record.history,
      { role: "user", content: userMessage, ...(turn === undefined ? {} : { turn }) },
      {
        role: "assistant",
        content: assistantAnswer,
        ...(turn === undefined ? {} : { turn }),
        ...(toolRounds !== undefined && toolRounds.length > 0 ? { tool_rounds: toolRounds } : {}),
      },
    ]);
    if (workspaceName !== "") record.workspaceName = workspaceName;
    record.turnCount += 1;
    record.updatedAt = this.deps.clock.now();
    this.scheduleFlush();
  }

  /**
   * Replaces history with a compacted pair (carrier user message plus summary).
   * Maintenance, not a turn: the turn counter is untouched so turn numbering stays
   * dense, and pairing stays user/assistant alternating for the trim logic.
   *
   * @param id Builder session id (must exist).
   * @param summary Handoff note, sliced to the message cap when oversized.
   */
  compactHistory(id: string, summary: string): void {
    const record = this.get(id);
    const clean = summary.trim().slice(0, BUILDER_MESSAGE_MAX_CHARS);
    if (clean === "") throw BuilderError.invalid("Compact summary must not be empty");
    record.history = [
      { role: "user", content: "[Earlier conversation compacted into the next message]" },
      { role: "assistant", content: clean },
    ];
    record.updatedAt = this.deps.clock.now();
    this.scheduleFlush();
  }

  /**
   * Queues a session notice rendered into the next turn's system prompt.
   * Capped: hot-swaps are user-driven and unbounded between turns, while only the latest
   * composition actually runs — evict oldest first so the queue can never bloat the prompt.
   */
  queueNotice(id: string, notice: string): void {
    this.get(id);
    const queue = this.pendingNotices.get(id) ?? [];
    queue.push(notice);
    while (queue.length > MAX_PENDING_NOTICES) queue.shift();
    this.pendingNotices.set(id, queue);
  }

  /** Drains the pending notice queue (FIFO); a notice is consumed exactly once. */
  takeNotices(id: string): string[] {
    const queue = this.pendingNotices.get(id);
    this.pendingNotices.delete(id);
    return queue ?? [];
  }

  /** Client-facing view. */
  view(record: BuilderSessionRecord): BuilderSessionView {
    return {
      id: record.id,
      name: record.name,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      composition: record.composition,
      history: [...record.history],
      running: record.running,
      turn_count: record.turnCount,
      workspace: record.workspaceName,
    };
  }

  /** Awaits the pending flush (used on delete / shutdown paths that want durability). */
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
      sessions: [...this.sessions.values()].map((record) => ({
        id: record.id,
        name: record.name,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        composition: record.composition,
        history: record.history,
        workspaceName: record.workspaceName,
        turnCount: record.turnCount,
      })),
    };
    try {
      await this.deps.file.write(payload);
    } catch (error) {
      // In-memory state stays authoritative; persistence loss is logged, never thrown into a turn.
      console.warn(`[builder-store] session flush failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Trims the oldest pairs until both caps hold (wire-contract accounting shared
 * via contracts/trimHistoryToCaps).
 */
function trimToCaps(history: BuilderChatMessage[]): BuilderChatMessage[] {
  return trimHistoryToCaps(history, { maxMessages: MAX_HISTORY_MESSAGES, maxChars: MAX_HISTORY_CHARS });
}
