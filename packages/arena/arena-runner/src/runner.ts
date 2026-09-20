/**
 * @file runner
 * @description Parallel run pool: one worker per PipelineConfig, events in arrival order.
 *
 * Responsibilities:
 * - Run columns concurrently and merge events through a shared channel
 * - Trip per-endpoint circuit breaking on repeated failures
 * - Cancel runs when the client disconnects
 */

import type { ArenaEvent, ArenaRunRequest, AskUserReply, AskUserQuestion, Clock, ColumnRuntimeFactory, ComparisonReport, DriverLookup, HarnessLevel, IdGenerator, MemoryServicePort, PipelineConfig, PipelineMetrics, ReportPublisher } from "@agentprism/contracts";
import { arenaErrorEvent, completeEvent, DEFAULT_ASK_USER_WAIT_MS, DriverReservedError, sanitizeErrorMessage, systemErrorEvent, systemReportEvent } from "@agentprism/contracts";
import { runAgentExecution, type AgentToolTuning } from "@agentprism/agent";
import type { ContextTuning } from "@agentprism/harness";
import type { McpServerConfig } from "@agentprism/tool-mcp";
import type { SessionQueryPort } from "@agentprism/contracts";
import { BreakerRegistry, EventChannel, Semaphore, WorkspaceRegistry } from "@agentprism/runtime";
import type { DimensionRouter } from "@agentprism/arena-routing";
import { RunTraceLogs } from "./column-logs.js";

/** Parallel run dependencies (injected at the composition root). */
export interface ArenaRunnerDeps {
  registry: DriverLookup;
  router: DimensionRouter;
  workspaceRegistry: WorkspaceRegistry;
  reportPublisher: ReportPublisher;
  modelFactory: ColumnRuntimeFactory;
  idGenerator: IdGenerator;
  clock: Clock;
  maxConcurrentRuns: number;
  /** Consecutive-failure threshold before an endpoint short-circuits (default 3). */
  breakerThreshold?: number;
  /** Breaker cooldown in ms before half-open probes (default 30000). */
  breakerCooldownMs?: number;
  /** Human-channel wait in ms before ask_user degrades to headless defer (default 5min). */
  askUserWaitMs?: number;
  /** Max simultaneously executing columns within one run (default 8, cap 16). */
  maxConcurrentColumns?: number;
  /** Operator MCP servers attached to top-level arena columns (absent = none). */
  mcpServers?: readonly McpServerConfig[];
  /** Read-only session query port for the session_query tool (absent = placeholder). */
  sessionsQuery?: SessionQueryPort;
  /** Operator-tuned context strategy budgets (absent fields keep built-in defaults). */
  contextTuning?: ContextTuning;
  /** Operator-tuned delegation/fetch knobs (absent fields keep built-in defaults). */
  toolTuning?: AgentToolTuning;
  /** Delegation ceiling for subagent spawning (default 1). */
  maxDelegationDepth?: number;
  /** Per-pipeline retained events for the comparison report (default 5000). */
  eventRetention?: number;
  /** Bounded teardown wait in ms after a client disconnect (default 5000). */
  disconnectGraceMs?: number;
  /** Cross-session memory service backing the memory dimension (absent = stateless runs). */
  memory?: MemoryServicePort;
  /** Operator-tuned harness retry caps per level (absent fields keep built-in defaults). */
  harnessMaxRetries?: Partial<Record<HarnessLevel, number>>;
}

interface WorkerHandle {
  done: boolean;
  finished: Promise<void>;
}

/** Defensive copy: transport serializes these, but in-process callers must not mutate live batches. */
function copyAskUserQuestion(question: AskUserQuestion): AskUserQuestion {
  return { ...question, options: [...question.options] };
}

/** One ask_user batch awaiting the human, keyed by agent id (one live turn per column). */
interface PendingAsk {
  questions: AskUserQuestion[];
  answers: Map<string, string>;
  settle: (reply: AskUserReply) => void;
  settled: boolean;
}

/** Default human-channel wait (single source: contracts; re-exported for compat). */
export { DEFAULT_ASK_USER_WAIT_MS } from "@agentprism/contracts";

/** Per-pipeline retained events for the comparison report (bounds multi-column memory). */
export const MAX_PIPELINE_EVENTS = 5_000;

/** Default column fan-out within one run (single run may route up to 16 columns). */
export const DEFAULT_MAX_CONCURRENT_COLUMNS = 8;

/**
 * Parallel run pool: one worker per PipelineConfig; events are merged in arrival
 * order through a shared channel. On client disconnect a cancel signal is sent to
 * all workers to avoid leaks.
 */
export class ArenaRunner {
  private readonly deps: ArenaRunnerDeps;
  /** Run-level admission gate (bounds concurrent runs; see acquireSlot). */
  private readonly runSlots: Semaphore;
  /** Column-level execution gate (bounds fan-out within one run). */
  private readonly columnSlots: Semaphore;
  /** Per-endpoint circuit breakers behind a capped registry (no unbounded growth). */
  private readonly breakers: BreakerRegistry;
  /** In-flight ask_user batches keyed by agent id (set only while a column waits on the human). */
  private readonly pendingAsks = new Map<string, PendingAsk>();
  /** Per-column abort controllers keyed by agent id: powers independent per-column stop (global abort still cancels all). */
  private readonly columnAborts = new Map<string, AbortController>();
  /** Terminal message for a user-initiated per-column stop (frontend matches this to render a paused badge, not an error). */
  static readonly COLUMN_STOPPED_MESSAGE = "Column stopped by user";
  private static readonly BREAKER_THRESHOLD = 3;
  private static readonly BREAKER_COOLDOWN_MS = 30_000;

  private readonly eventRetention: number;
  private readonly disconnectGraceMs: number;

  constructor(deps: ArenaRunnerDeps) {
    this.deps = deps;
    this.eventRetention = deps.eventRetention ?? MAX_PIPELINE_EVENTS;
    this.disconnectGraceMs = deps.disconnectGraceMs ?? 5_000;
    this.runSlots = new Semaphore(Math.max(1, deps.maxConcurrentRuns));
    const columns = deps.maxConcurrentColumns ?? DEFAULT_MAX_CONCURRENT_COLUMNS;
    this.columnSlots = new Semaphore(Number.isFinite(columns) ? Math.min(16, Math.max(1, Math.trunc(columns))) : DEFAULT_MAX_CONCURRENT_COLUMNS);
    this.breakers = new BreakerRegistry({
      threshold: deps.breakerThreshold ?? ArenaRunner.BREAKER_THRESHOLD,
      cooldownMs: deps.breakerCooldownMs ?? ArenaRunner.BREAKER_COOLDOWN_MS,
      now: () => this.deps.clock.now(),
    });
  }

  /** Breaker registry size (telemetry: unbounded growth guard). */
  breakerCount(): number {
    return this.breakers.size;
  }

  /** Queued columns waiting for a column slot (telemetry). */
  columnQueueDepth(): number {
    return this.columnSlots.queueDepth;
  }

  /** Configured human-channel wait (finite positive, else the default). */
  private askUserWaitMs(): number {
    const raw = this.deps.askUserWaitMs ?? DEFAULT_ASK_USER_WAIT_MS;
    return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : DEFAULT_ASK_USER_WAIT_MS;
  }

  /** Pending ask_user questions for one column (copies; empty when none waiting). */
  pendingAsk(agentId: string): AskUserQuestion[] {
    const pending = this.pendingAsks.get(agentId);
    if (pending === undefined || pending.settled) return [];
    return pending.questions.map(copyAskUserQuestion);
  }

  /** All columns currently waiting on the human (agent id + questions). */
  listPendingAsks(): Array<{ agentId: string; questions: AskUserQuestion[] }> {
    const out: Array<{ agentId: string; questions: AskUserQuestion[] }> = [];
    for (const [agentId, pending] of this.pendingAsks) {
      if (!pending.settled) out.push({ agentId, questions: pending.questions.map(copyAskUserQuestion) });
    }
    return out;
  }

  get registry(): DriverLookup {
    return this.deps.registry;
  }

  /** Resolves per-column configs; for non-temperature dimensions the request-level temperature overrides all columns. */
  configsFor(request: ArenaRunRequest): PipelineConfig[] {
    let configs = this.deps.router.route(request.dimension, request.selections, request.baseline);
    // Hoisted to a const: property narrowing does not survive into the map callback, and a cast would hide that.
    const temperatureOverride = request.temperature;
    if (temperatureOverride !== null && temperatureOverride !== undefined && request.dimension !== "temperature") {
      configs = configs.map((config) => ({ ...config, temperature: temperatureOverride }));
    }
    // Empty labels would drift the pipeline aggregation key (the event side falls back to
    // displayName while reports/failure paths use the raw value): normalize uniformly at
    // the routing exit so the whole chain has one identity (events contract: producers keep it unique)
    return configs.map((config) =>
      config.label.trim() !== "" ? config : { ...config, label: config.framework },
    );
  }

  async *streamParallel(
    request: ArenaRunRequest,
    options: { signal?: AbortSignal } = {},
  ): AsyncGenerator<ArenaEvent> {
    let configs: PipelineConfig[];
    try {
      configs = this.configsFor(request);
    } catch (error) {
      yield systemErrorEvent(error instanceof Error ? error.message : sanitizeErrorMessage(error));
      return;
    }

    const runId = this.deps.idGenerator.next();
    const channel = new EventChannel<ArenaEvent | null>();
    const internalAbort = new AbortController();
    const signal = options.signal;
    const forwardAbort = () => internalAbort.abort();
    signal?.addEventListener("abort", forwardAbort, { once: true });
    // Already cancelled before entering: the abort event has fired and listeners will not
    // trigger again, so sync explicitly
    if (signal?.aborted) internalAbort.abort();

    const eventsByPipeline: Record<string, ArenaEvent[]> = {};
    const metricsByPipeline: Record<string, PipelineMetrics | null> = {};
    // Per-run observability logs: raw event stream + LLM wire records appended to
    // <runsRoot>/<runId>/_traces. Fail-open end to end: a broken runs root only
    // disables the logs, it never kills the run they observe.
    let logs: RunTraceLogs | null = null;
    try {
      logs = new RunTraceLogs(this.deps.workspaceRegistry.traceDir(runId), () => this.deps.clock.now());
    } catch (error) {
      console.warn(`[arena-runner] run log init failed (logs disabled): ${error instanceof Error ? error.message : String(error)}`);
    }
    const workers = configs.map((config) =>
      this.spawnWorker(config, request, channel, runId, internalAbort.signal, request.interactive === true, logs),
    );

    try {
      let finished = 0;
      while (finished < workers.length) {
        const item = await channel.receive(500);
        if (item.kind === "timeout") {
          if (workers.every((worker) => worker.done)) break;
          continue;
        }
        if (item.kind === "closed") break;
        if (item.value === null) {
          finished += 1;
          continue;
        }
        const event = item.value;
        const bucket = (eventsByPipeline[event.pipeline] ??= []);
        bucket.push(event);
        // Raw-log tail for the logs-comparison page: the exact stream the SSE
        // consumer sees, attributed per column by the event's pipeline label.
        if (event.pipeline !== "") logs?.appendEvent(event.pipeline, event);
        // Memory cap (catastrophic backstop; ordinary columns emit hundreds):
        // tail retention keeps workspace resolution and recent steps exact,
        // while extreme tails lose early ablation counts. Terminal verdicts
        // always survive separately in metricsByPipeline.
        if (bucket.length > this.eventRetention) {
          bucket.splice(0, bucket.length - this.eventRetention);
        }
        if (event.type === "complete" && event.metrics) {
          metricsByPipeline[event.pipeline] = event.metrics;
        }
        yield event;
      }

      // Comparison report (SSE tail): published through the port so orchestration does not depend on the evaluation implementation
      try {
        const report: ComparisonReport | null = await this.deps.reportPublisher.publish({
          request,
          configs,
          eventsByPipeline,
          metricsByPipeline,
          signal: internalAbort.signal,
        });
        if (report !== null) {
          yield systemReportEvent({
            content: JSON.stringify(report),
            runId,
            timestamp: this.deps.clock.now(),
          });
        }
      } catch (error) {
        // A report-generation failure does not affect already-pushed events, but leave a trace for troubleshooting
        console.warn(`[arena] Comparison report generation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      signal?.removeEventListener("abort", forwardAbort);
      // Consumer exited early (client disconnect): notify workers to cancel and wait for teardown
      internalAbort.abort();
      // Bounded wait: settles with `pending` or after the disconnect grace,
      // whichever comes first. The timer is unrefed and cleared on every path,
      // so a fast teardown never leaves a handle pinning the event loop.
      const bounded = (pending: Promise<unknown>): Promise<void> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<void>((resolve) => {
          timer = setTimeout(resolve, this.disconnectGraceMs);
          timer.unref?.();
        });
        return Promise.race([pending, timeout])
          .then(() => undefined)
          .finally(() => {
            if (timer !== undefined) clearTimeout(timer);
          });
      };
      await bounded(Promise.all(workers.map((worker) => worker.finished)));
      // Drain in-flight log appends before the stream settles: the logs page
      // stops polling at settle and a process exit right after the run would
      // otherwise drop the tail rows. flush() never rejects (fail-open appends
      // swallow their own errors); the bound keeps a pathological producer from
      // extending the stream close past the grace window.
      if (logs !== null) await bounded(logs.flush());
    }
  }

  /** Global concurrency gate: acquires a run slot (the HTTP layer wraps the whole event-stream consumption); supports cancellation. */
  acquireSlot(options: { signal?: AbortSignal } = {}): Promise<() => void> {
    return this.runSlots.acquire(options);
  }

  /**
   * Independently stops one live column (other columns keep running).
   * The worker emits a stopped error + failed complete so the SSE stream settles normally.
   *
   * @returns Whether a live column was found and signalled.
   */
  stopColumn(agentId: string): boolean {
    const controller = this.columnAborts.get(agentId);
    if (controller === undefined || controller.signal.aborted) return false;
    controller.abort();
    return true;
  }

  /**
   * Delivers one human answer to a column's pending ask_user batch.
   *
   * @returns Whether a live column was waiting on that question id.
   */
  answerQuestion(agentId: string, questionId: string, answer: string): boolean {
    const pending = this.pendingAsks.get(agentId);
    if (pending === undefined || pending.settled) return false;
    if (!pending.questions.some((question) => question.id === questionId)) return false;
    pending.answers.set(questionId, answer);
    if (pending.answers.size >= pending.questions.length) {
      // settle owns the settled flag: pre-setting it here would trip the
      // idempotency guard and leave the tool's promise unresolved forever.
      pending.settle({ answered: true, answers: [...pending.answers].map(([qid, text]) => ({ id: qid, answer: text })) });
    }
    return true;
  }

  /** Ask-side of the human channel for one column (same settle semantics as the builder). */
  private awaitUserAnswers(agentId: string, questions: readonly AskUserQuestion[], signal?: AbortSignal): Promise<AskUserReply> {
    this.pendingAsks.delete(agentId);
    return new Promise<AskUserReply>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const pending: PendingAsk = {
        questions: [...questions],
        answers: new Map(),
        settled: false,
        settle: (reply) => {
          if (pending.settled) return;
          pending.settled = true;
          if (timer !== undefined) clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          // agentId keys are unique per run; a defensive-path settle must not
          // evict a successor batch anyway.
          if (this.pendingAsks.get(agentId) === pending) this.pendingAsks.delete(agentId);
          resolve(reply);
        },
      };
      const onAbort = () => pending.settle({ answered: false, answers: [] });
      this.pendingAsks.set(agentId, pending);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      timer = setTimeout(() => pending.settle({ answered: false, answers: [] }), this.askUserWaitMs());
      timer.unref?.();
    });
  }

  private getBreaker(endpointId: string) {
    // Time source comes from the injected Clock, keeping the same epoch as the runner's other timing.
    return this.breakers.get(endpointId);
  }

  private spawnWorker(
    config: PipelineConfig,
    request: ArenaRunRequest,
    channel: EventChannel<ArenaEvent | null>,
    runId: string,
    signal: AbortSignal,
    interactive: boolean,
    logs: RunTraceLogs | null,
  ): WorkerHandle {
    const handle: WorkerHandle = { done: false, finished: Promise.resolve() };
    handle.finished = (async () => {
      // Column-level gate: one run may route up to 16 columns; without this,
      // N concurrent runs fan out to N*16 simultaneous LLM executions.
      let releaseColumn: (() => void) | null = null;
      try {
        releaseColumn = await this.columnSlots.acquire({ signal });
      } catch {
        // Cancelled while queued (client disconnect): the column never started,
        // so there is nothing to report and nothing the breaker may count —
        // just settle the drain counter the stream loop waits on.
        handle.done = true;
        channel.push(null);
        return;
      }
      const breaker = this.getBreaker(config.endpoint_id);
      // Per-column abort: linked signal fires when either the global run aborts or this column is stopped alone.
      const columnAbort = new AbortController();
      const linked = new AbortController();
      const forwardGlobal = () => {
        if (!linked.signal.aborted) linked.abort();
      };
      const forwardColumn = () => {
        if (!linked.signal.aborted) linked.abort();
      };
      signal.addEventListener("abort", forwardGlobal, { once: true });
      columnAbort.signal.addEventListener("abort", forwardColumn, { once: true });
      if (signal.aborted || columnAbort.signal.aborted) forwardGlobal();
      let agentId = "";
      try {
        if (breaker.isOpen()) {
          this.emitFailure(
            channel,
            config,
            request,
            runId,
            `Endpoint ${config.endpoint_id} is temporarily circuit-broken (too many consecutive failures; cooling down)`,
          );
          return;
        }

        const driver = this.deps.registry.get(config.framework);
        const session = request.column_sessions?.[config.label];
        const history = session !== undefined ? [...session.messages] : [...request.messages];
        const turn = Math.floor(history.length / 2) + 1;
        // Wire tracer rides on the column model (both the LlmAdapter and the vendor
        // instance share one BaseChatModel), so native and LC/LG columns are all observed.
        const runtime = this.deps.modelFactory.create(config, {
          wireSink: (record) => logs?.appendWire(config.label, turn, record),
        });
        agentId = this.deps.idGenerator.next();
        this.columnAborts.set(agentId, columnAbort);
        let sawError = false;
        for await (const event of runAgentExecution(
          {
            workspaceRegistry: this.deps.workspaceRegistry,
            idGenerator: this.deps.idGenerator,
            clock: this.deps.clock,
            memory: this.deps.memory,
          },
          {
            driver,
            config,
            question: request.question,
            history,
            turn,
            agentId,
            runId,
            columnRuntime: runtime,
            existingWorkspaceName: session?.workspace,
            attachments: request.attachments,
            mcpServers: this.deps.mcpServers,
            sessions: this.deps.sessionsQuery,
            contextTuning: this.deps.contextTuning,
            toolTuning: this.deps.toolTuning,
            maxDelegationDepth: this.deps.maxDelegationDepth,
            askUser: interactive
              ? (questions, askSignal) => this.awaitUserAnswers(agentId, questions, askSignal)
              : undefined,
            signal: linked.signal,
          },
        )) {
          // Downstream failures (LLM timeouts etc.) are absorbed by the agent layer into error
          // events and never reach this layer's catch
          if (event.type === "error") sawError = true;
          channel.push(event);
        }
        // Client cancellation does not change counters; a column ending with an error event counts as failure, otherwise success
        if (!linked.signal.aborted) {
          if (sawError) breaker.recordFailure();
          else breaker.recordSuccess();
        }
      } catch (error) {
        const columnStopped = columnAbort.signal.aborted && !signal.aborted;
        if (columnStopped) {
          // User-initiated per-column stop: not a downstream failure, never counts toward the breaker.
          this.emitFailure(channel, config, request, runId, ArenaRunner.COLUMN_STOPPED_MESSAGE);
        } else if (error instanceof DriverReservedError) {
          // An unimplemented framework is a dimension configuration error, not a downstream endpoint failure; do not count toward the breaker
          this.emitFailure(channel, config, request, runId, `Framework "${error.frameworkId}" is not implemented`);
        } else {
          // Client cancellation / shutdown aborts are not downstream failures; do not count toward breaker failures
          if (!linked.signal.aborted && (error as Error)?.name !== "AbortError") {
            breaker.recordFailure();
          }
          this.emitFailure(channel, config, request, runId, sanitizeErrorMessage(error));
        }
      } finally {
        signal.removeEventListener("abort", forwardGlobal);
        columnAbort.signal.removeEventListener("abort", forwardColumn);
        if (agentId !== "") {
          if (this.columnAborts.get(agentId) === columnAbort) this.columnAborts.delete(agentId);
        }
        releaseColumn?.();
        handle.done = true;
        channel.push(null);
      }
    })();
    return handle;
  }

  private emitFailure(
    channel: EventChannel<ArenaEvent | null>,
    config: PipelineConfig,
    request: ArenaRunRequest,
    runId: string,
    message: string,
  ): void {
    const session = request.column_sessions?.[config.label];
    const turn = Math.floor((session?.messages ?? request.messages).length / 2) + 1;
    channel.push(
      arenaErrorEvent({
        pipeline: config.label,
        message,
        turn,
        runId,
        timestamp: this.deps.clock.now(),
      }),
    );
    channel.push(
      completeEvent({
        pipeline: config.label,
        metrics: {
          success: false,
          duration_ms: 0,
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          tool_calls: 0,
          steps: 0,
          // A fabricated failed column has no real window config; zero it so fake window metadata never flows into aggregate stats.
          context_window: 0,
          max_input_tokens: 0,
          max_output_tokens: 0,
          context_usage_pct: 0.0,
          input_usage_pct: 0.0,
        },
        token_stats: null,
        turn,
        runId,
        timestamp: this.deps.clock.now(),
      }),
    );
  }
}
