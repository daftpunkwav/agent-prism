/**
 * @file thread-service
 * @description Agent thread use cases: durable resume runs and workspace-branching forks.
 *
 * Responsibilities:
 * - Run one more turn on a thread through the full arena pipeline (slot, breakers,
 *   events, workspace reuse, sandbox, approval), committing the transcript only on success
 * - Fork a thread: copy the transcript and branch the workspace directory
 * - Guard concurrency (one live turn per thread, a fork holds its parent busy) and
 *   lifecycle (create/fork/list/delete)
 *
 * Resume semantics are thread-level, not step-level: an interrupted turn leaves the
 * transcript untouched, so the next run resumes from the last committed point.
 */

import type { ArenaEvent, Clock, ThreadCreateRequest, ThreadForkRequest, ThreadRunRequest, ThreadView } from "@agentprism/contracts";
import type { ArenaRunRequest, PipelineConfig, ToolRound } from "@agentprism/contracts";
import { extractAnswerFromEvents, extractToolRounds } from "@agentprism/contracts";
import type { WorkspaceRegistry } from "@agentprism/runtime";
import { isSafeWorkspaceSegment, sanitizeErrorMessage } from "@agentprism/contracts";
import type { ArenaService } from "./arena-service.js";
import { AppError } from "./errors.js";
import type { FileThreadStore, ThreadRecord } from "./thread-store.js";
import type { SessionService } from "./session-service.js";

/** Workspace name prefix for thread-owned workspaces: `t-<thread id>` (ids are 12-hex). */
const THREAD_WORKSPACE_PREFIX = "t-";

/** Event tail kept for answer extraction (answers arrive late; the head is never needed). */
const ANSWER_EVENT_TAIL = 2_000;

/** Narrow workspace seam the service needs (satisfied by WorkspaceRegistry). */
export interface ThreadWorkspaces {
  /** Number of live-run protection holds on the named workspace. */
  protectedCount(name: string): number;
  /** Copies one idle workspace directory into a new registered workspace. */
  clone(sourceName: string, newName: string): Promise<unknown>;
  /** Exempts a workspace from TTL/LRU eviction (idempotent). */
  pin(name: string): void;
  /** Releases an eviction pin (no-op when absent). */
  unpin(name: string): void;
}

export interface ThreadServiceDeps {
  threads: FileThreadStore;
  arena: ArenaService;
  workspaceRegistry: ThreadWorkspaces;
  clock: Clock;
  /** Execution ledger: thread turns land here as agent sessions (absent = no agent ledger). */
  sessions?: SessionService;
  /** Event tail retained for answer extraction, in events (default 2000). */
  answerTailChars?: number;
}

export class ThreadService {
  private readonly deps: ThreadServiceDeps;
  private readonly answerTail: number;

  constructor(deps: ThreadServiceDeps) {
    this.deps = deps;
    this.answerTail = deps.answerTailChars ?? ANSWER_EVENT_TAIL;
  }

  /** Creates a root thread with a pinned config (empty title gets a generated one). */
  create(request: ThreadCreateRequest): ThreadView {
    // Validate with the run path's own rules before storing: the config is
    // immutable afterwards, so an unreplayable value would brick the thread
    // instead of surfacing as a create-time error.
    this.deps.arena.assertBaselineReplayable(THREAD_DIMENSION, [request.config.framework], baselineOverridesOf(request.config));
    const record = this.deps.threads.create(request.title ?? "", request.config);
    return this.deps.threads.view(record);
  }

  /** Lists threads oldest-first (views only; fetch the detail for transcripts). */
  list(): ThreadView[] {
    return this.deps.threads.list().map((record) => this.deps.threads.view(record));
  }

  /** Gets one thread with its full transcript; re-pins the workspace (in-memory pins die with a process). */
  getDetail(id: string): { thread: ThreadView; history: ThreadRecord["history"] } {
    const record = this.deps.threads.get(id);
    if (record.workspace !== "") this.deps.workspaceRegistry.pin(record.workspace);
    return { thread: this.deps.threads.view(record), history: [...record.history] };
  }

  /** Deletes a thread (409 while a turn is running) and releases its workspace pin. */
  deleteThread(id: string): ThreadView {
    // Delete first: the store refuses while a turn is running, and a refused
    // delete must not have released the eviction pin already — the record would
    // keep pointing at a workspace that eviction may now reclaim.
    const deleted = this.deps.threads.delete(id);
    if (deleted.workspace !== "") this.deps.workspaceRegistry.unpin(deleted.workspace);
    return this.deps.threads.view(deleted);
  }

  /**
   * Forks a thread: copied transcript/config plus a branched workspace directory.
   * The parent stays untouched; a failed workspace branch leaves no record behind.
   * The parent is held busy for the whole branch — the guards above are
   * point-in-time, and a turn starting mid-copy would write the tree being copied.
   */
  async fork(id: string, request: ThreadForkRequest): Promise<ThreadView> {
    const parent = this.deps.threads.get(id);
    if (parent.running) {
      throw AppError.conflict("Cannot fork a thread while a turn is running");
    }
    if (parent.workspace !== "" && this.deps.workspaceRegistry.protectedCount(parent.workspace) > 0) {
      throw AppError.conflict("Cannot fork while the source workspace is in an active run");
    }
    this.deps.threads.markRunning(id, true);
    try {
      const fork = this.deps.threads.fork(id, request.title ?? "");
      if (parent.workspace !== "") {
        const cloneName = `${THREAD_WORKSPACE_PREFIX}${fork.id}`;
        try {
          await this.deps.workspaceRegistry.clone(parent.workspace, cloneName);
        } catch (error) {
          // No half-created forks: a failed branch removes the record and surfaces the reason.
          this.deps.threads.delete(fork.id);
          throw error;
        }
        this.deps.threads.setWorkspace(fork.id, cloneName);
        this.deps.workspaceRegistry.pin(cloneName);
      }
      return this.deps.threads.view(fork);
    } finally {
      this.deps.threads.markRunning(id, false);
    }
  }

  /**
   * Runs one more turn on the thread (the resume path): replays the stored
   * transcript and reuses the stored workspace through the arena pipeline.
   * The transcript commits only on a successful completion; failures and
   * aborts leave it untouched so the next run resumes from the same point.
   *
   * @yields The single column's arena events (SSE-ready).
   */
  /** Throws 404/409 early so HTTP callers get status codes instead of in-stream errors. */
  assertIdle(id: string): void {
    const record = this.deps.threads.get(id);
    if (record.running) {
      throw AppError.conflict(`Thread "${id}" already has a turn running`);
    }
  }

  /** Awaits the store's pending debounced write (shutdown durability). */
  flush(): Promise<void> {
    return this.deps.threads.flushNow();
  }

  /** Ledger writes are best-effort: a sick ledger must never break the turn it observes. */
  private async safeLedger<T>(action: string, task: () => Promise<T>): Promise<T | null> {
    if (this.deps.sessions === undefined) return null;
    try {
      return await task();
    } catch (error) {
      console.warn(
        `[thread] session ledger ${action} failed, continuing turn: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  async *run(id: string, request: ThreadRunRequest, options: { signal?: AbortSignal } = {}): AsyncGenerator<ArenaEvent> {
    const thread = this.deps.threads.get(id);
    if (thread.running) {
      throw AppError.conflict(`Thread "${id}" already has a turn running`);
    }
    this.deps.threads.markRunning(id, true);
    // Agent-kind ledger row: thread turns are the single-agent runs, so they
    // give the agent session kind its production writer (arena runs already
    // cover the arena kind, builder turns the builder kind).
    const sessions = this.deps.sessions;
    const ledger = sessions === undefined
      ? null
      : await this.safeLedger("create", () =>
        sessions.startSession("agent", `thread ${id} turn`, { threadId: id }),
      );
    try {
      yield* this.streamTurn(thread, request, options);
      if (sessions !== undefined && ledger !== null) {
        await this.safeLedger("complete", () => sessions.completeSession(ledger.id));
      }
    } catch (error) {
      if (sessions !== undefined && ledger !== null) {
        if (options.signal?.aborted) {
          await this.safeLedger("cancel", () => sessions.cancelSession(ledger.id));
        } else {
          await this.safeLedger("fail", () => sessions.failSession(ledger.id, sanitizeErrorMessage(error)));
        }
      }
      throw error;
    } finally {
      this.deps.threads.markRunning(id, false);
    }
  }

  private async *streamTurn(
    thread: ThreadRecord,
    request: ThreadRunRequest,
    options: { signal?: AbortSignal },
  ): AsyncGenerator<ArenaEvent> {
    const label = `${THREAD_WORKSPACE_PREFIX}${thread.id}`;
    const arenaRequest = this.buildArenaRequest(thread, request.question, label);
    const collected: ArenaEvent[] = [];
    // Tool rounds accumulate incrementally as pairs close, so a very long run
    // never loses early rounds to the bounded answer-extraction tail.
    const seenEvents: ArenaEvent[] = [];
    let toolRounds: ReturnType<typeof extractToolRounds> = [];

    for await (const event of this.deps.arena.run(arenaRequest, { signal: options.signal })) {
      collected.push(event);
      if (collected.length > this.answerTail) collected.shift();
      seenEvents.push(event);
      if (event.type === "action" || event.type === "observation") {
        toolRounds = extractToolRounds(seenEvents);
      }
      if (event.type === "complete" && event.pipeline === label) {
        const success = event.metrics?.success === true;
        if (success) {
          const answer = extractAnswerFromEvents(collected);
          if (answer.trim() === "") {
            // The store commits a placeholder; make the degenerate extraction observable.
            console.warn(`[thread] turn on ${thread.id} completed without an extractable answer`);
          }
          this.deps.threads.appendTurn(thread.id, request.question, answer, event.workspace, toolRounds);
          if (event.workspace !== "") this.deps.workspaceRegistry.pin(event.workspace);
          // The committed turn IS the resume anchor: flush past the debounce so a
          // shutdown right after completion cannot lose it.
          void this.deps.threads.flushNow();
        }
      }
      yield event;
    }
  }

  /**
   * Builds a single-column arena request that replays the thread: baseline
   * overrides carry the pinned config, column_sessions carries transcript and
   * workspace. Deliberately not schema-parsed — thread history follows the
   * store's configured caps, which are looser than the wire caps meant for
   * clients.
   */
  private buildArenaRequest(thread: ThreadRecord, question: string, label: string): ArenaRunRequest {
    const session: {
      workspace?: string;
      messages: Array<{ role: "user" | "assistant"; content: string; tool_rounds?: ToolRound[] }>;
    } = {
      messages: thread.history.map((message) => ({
        role: message.role,
        content: message.content,
        ...(message.tool_rounds !== undefined && message.tool_rounds.length > 0
          ? { tool_rounds: message.tool_rounds }
          : {}),
      })),
    };
    if (thread.workspace !== "" && isSafeWorkspaceSegment(thread.workspace)) {
      session.workspace = thread.workspace;
    }
    return {
      question,
      // Single column: the thread's own framework as the one selection (the
      // router requires at least one), with every other field pinned by baseline.
      dimension: THREAD_DIMENSION,
      selections: [thread.config.framework],
      baseline: { ...baselineOverridesOf(thread.config), label },
      messages: [],
      column_sessions: { [label]: session },
      interactive: false,
    };
  }
}

/**
 * Baseline-supported fields replayed from the pinned config, as a single
 * source so a new PipelineConfig baseline field is added exactly here
 * (model_id deliberately absent: it derives from endpoint resolution).
 * Exported for the coverage test that locks this list against
 * `BaselineOverridesSchema` — a baseline field missing here would silently
 * stop being pinned.
 */
export const THREAD_BASELINE_FIELDS = [
  "framework",
  "reasoning",
  "context",
  "harness",
  "prompt_profile",
  "temperature",
  "endpoint_id",
  "thinking_level",
  "top_p",
  "frequency_penalty",
  "presence_penalty",
  "max_output_tokens",
  "max_steps",
  "toolset",
  "mcp_policy",
  "skill_policy",
  "approval_mode",
  "sandbox_mode",
  "orchestration",
  "memory",
  "history_mode",
] as const;

/** Comparison dimension a thread run pins to (single column of the thread's framework). */
const THREAD_DIMENSION = "framework";

function baselineOverridesOf(config: PipelineConfig): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  for (const field of THREAD_BASELINE_FIELDS) {
    const value = config[field];
    // "" is the schema default for endpoint_id, i.e. "unset": replaying it would
    // fail baseline legality instead of taking the default endpoint the run path
    // resolves for an absent value.
    if (value === "") continue;
    overrides[field] = value;
  }
  return overrides;
}
