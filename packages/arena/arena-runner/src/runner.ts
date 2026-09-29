/**
 * @file runner
 * @description Parallel run pool: one worker per PipelineConfig, events in arrival order.
 *
 * Responsibilities:
 * - Run columns concurrently and merge events through a shared channel
 * - Trip per-endpoint circuit breaking on repeated failures
 * - Cancel runs when the client disconnects
 */

import type { ArenaEvent, ArenaRunRequest, AskUserQuestion, Clock, ColumnRuntimeFactory, ComparisonReport, DriverLookup, HarnessLevel, IdGenerator, MemoryServicePort, ModelCallOutcome, PipelineConfig, PipelineMetrics, ReportPublisher } from "@agentprism/contracts";
import { arenaErrorEvent, completeEvent, DriverReservedError, sanitizeErrorMessage, systemErrorEvent, systemReportEvent } from "@agentprism/contracts";
import { runAgentExecution, type AgentToolTuning } from "@agentprism/agent";
import type { McpServerConfig } from "@agentprism/tool-mcp";
// ContextTuning is a contracts type: read it from its owner, not through the
// harness re-export (this package never imports harness otherwise).
import type { ContextTuning, SessionQueryPort } from "@agentprism/contracts";
import { AskUserChannel, BreakerRegistry, EventChannel, Semaphore, WorkspaceRegistry } from "@agentprism/runtime";
import type { DimensionRouter } from "@agentprism/arena-dimensions";
import { RunTraceLogs } from "./run-trace-logs.js";

/** Parallel run dependencies (injected at the composition root). */
export interface ArenaRunnerDeps {
  /** Resolves the agent driver per framework id (the run's execution backends). */
  drivers: DriverLookup;
  router: DimensionRouter;
  workspaceRegistry: WorkspaceRegistry;
  reportPublisher: ReportPublisher;
  /** Builds the model runtime of one column (wire capture attaches at construction). */
  modelRuntime: ColumnRuntimeFactory;
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

/**
 * Turn number from replayed history: one user message opens one turn.
 * Pair-counting (floor(length / 2) + 1) drifts whenever messages are not
 * strictly alternating (consecutive same-role entries, odd lengths), so count
 * the questions instead.
 */
function turnFromHistory(messages: ReadonlyArray<{ role: unknown }>): number {
  let userMessages = 0;
  for (const message of messages) {
    if (message.role === "user") userMessages += 1;
  }
  return userMessages + 1;
}

/** Default human-channel wait (single source: contracts). */
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
  private readonly askChannel: AskUserChannel;
  /** Per-column abort controllers keyed by agent id: powers independent per-column stop (global abort still cancels all). */
  private readonly columnAborts = new Map<string, AbortController>();
  /** Terminal message for a user-initiated per-column stop (frontend matches this to render a paused badge, not an error). */
  static readonly COLUMN_STOPPED_MESSAGE = "Column stopped by user";
  private static readonly BREAKER_THRESHOLD = 3;
  /** Buffered-event ceiling for the merge channel (slow-consumer backstop). */
  private static readonly CHANNEL_BACKSTOP = 50_000;
  private static readonly BREAKER_COOLDOWN_MS = 30_000;

  private readonly eventRetention: number;
  private readonly disconnectGraceMs: number;

  constructor(deps: ArenaRunnerDeps) {
    this.deps = deps;
    this.askChannel = new AskUserChannel({ waitMs: deps.askUserWaitMs });
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

  /** Pending ask_user questions for one column (copies; empty when none waiting). */
  pendingAsk(agentId: string): AskUserQuestion[] {
    return this.askChannel.pendingQuestions(agentId);
  }

  /** All columns currently waiting on the human (agent id + questions). */
  listPendingAsks(): Array<{ agentId: string; questions: AskUserQuestion[] }> {
    return this.askChannel.listPending().map(({ key, questions }) => ({ agentId: key, questions }));
  }

  get drivers(): DriverLookup {
    return this.deps.drivers;
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
    // Catastrophic backstop, NOT the retention window: a consumer that stalls (slow
    // SSE client) must not let column pushes grow this buffer forever, while normal
    // runs stay far below the bound so the per-pipeline retention decides what the
    // report sees. Drops are reported once at the end of the drain.
    const channel = new EventChannel<ArenaEvent | null>({ capacity: ArenaRunner.CHANNEL_BACKSTOP });
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
        //
        // Drop from the front with shift(), not splice(0, overflow): the overflow is
        // one event (this is the only push site) and the cap must not cost a full
        // tail memmove per streamed chunk — splice(0, 1) measures ~12.6 us/event at
        // the 5 000 default retention vs ~0.2 us for shift(), which V8 left-trims.
        // The splice branch keeps the cap exact should another push site appear.
        const overflow = bucket.length - this.eventRetention;
        if (overflow === 1) bucket.shift();
        else if (overflow > 0) bucket.splice(0, overflow);
        if (event.type === "complete" && event.metrics) {
          metricsByPipeline[event.pipeline] = event.metrics;
        }
        yield event;
      }

      const dropped = channel.droppedCount();
      if (dropped > 0) {
        // Loud, not silent — but through the server log, not the stream: a run-level
        // error event is the frontend's signal to abort the turn and strip it, so
        // reporting a slow-consumer degradation that way would destroy a run that is
        // otherwise fine. Reaching this bound means a consumer stalled badly.
        console.warn(
          `[arena-runner] dropped ${dropped} event(s): the consumer read slower than the run produced`,
        );
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
      // Observability for the teardown path: a worker still running past the
      // grace window has had its abort signal fired and is left to the driver's
      // own cancellation, but the leak risk must be visible instead of silent.
      const unfinished = workers.filter((worker) => !worker.done).length;
      if (unfinished > 0) {
        console.warn(`[arena-runner] ${unfinished} column worker(s) still running after the disconnect grace`);
      }
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
    return this.askChannel.answer(agentId, questionId, answer);
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

        const driver = this.deps.drivers.get(config.framework);
        const session = request.column_sessions?.[config.label];
        const history = session !== undefined ? [...session.messages] : [...request.messages];
        const turn = turnFromHistory(history);
        // Wire tracer rides on the column model (both the LlmAdapter and the vendor
        // instance share one BaseChatModel), so native, the LangChain family and the
        // OpenAI Agents bridge are all observed.
        //
        // Endpoint health arrives through TWO observers feeding one sink: the wire-trace
        // handler attached here (it sees every call of the shared chat model, and the
        // column's own signal filters out cancelled ones) and the execution context
        // below, which is how a driver that owns its model transport reports — today the
        // Claude Agent SDK column, whose CLI subprocess makes the calls itself. Either
        // way the breaker reflects the shared dependency, not whichever column finished
        // last, and a column that is stopping reports nothing.
        // The sink's parameter is the contracts type, not a structural inline: the
        // same named contract the two reporters (wire-trace handler, driver context)
        // consume, so an outcome-shape evolution cannot pass type checking here.
        const reportModelCall = (outcome: ModelCallOutcome): void => {
          if (linked.signal.aborted) return;
          if (outcome.ok) breaker.recordSuccess();
          else breaker.recordFailure();
        };
        const runtime = this.deps.modelRuntime.create(config, {
          wireSink: (record) => logs?.appendWire(config.label, turn, record),
          onModelCall: reportModelCall,
        });
        agentId = this.deps.idGenerator.next();
        this.columnAborts.set(agentId, columnAbort);
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
            language: request.language,
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
            harnessMaxRetries: this.deps.harnessMaxRetries,
            maxDelegationDepth: this.deps.maxDelegationDepth,
            askUser: interactive
              ? (questions, askSignal) => this.askChannel.awaitAnswers(agentId, questions, askSignal)
              : undefined,
            // Same sink the model callbacks report to: a driver with its own transport
            // (Claude Agent SDK CLI) is otherwise invisible to the breaker.
            onModelCall: reportModelCall,
            signal: linked.signal,
          },
        )) {
          // Downstream failures (LLM timeouts etc.) are absorbed by the agent layer into
          // error events and never reach this layer's catch.
          channel.push(event);
        }
        // No breaker accounting here: endpoint health arrives per model call (the
        // callback handler and the driver's own reports), so a driver that fails on its own cannot trip the
        // shared endpoint, and breaker state no longer depends on finish order.
      } catch (error) {
        const columnStopped = columnAbort.signal.aborted && !signal.aborted;
        if (columnStopped) {
          // User-initiated per-column stop: not a downstream failure, never counts toward the breaker.
          this.emitFailure(channel, config, request, runId, ArenaRunner.COLUMN_STOPPED_MESSAGE);
        } else if (error instanceof DriverReservedError) {
          // An unimplemented framework is a dimension configuration error, not a downstream endpoint failure; do not count toward the breaker
          this.emitFailure(channel, config, request, runId, `Framework "${error.frameworkId}" is not implemented`);
        } else {
          // Not counted toward the breaker: this catch sees driver-level failures too,
          // and endpoint health is reported per model call instead.
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
    const turn = turnFromHistory(session?.messages ?? request.messages);
    // A pinned column has a real workspace on disk; echoing it keeps the client
    // workspace panel usable for the failed column instead of a blank name.
    const workspace = session?.workspace ?? "";
    channel.push(
      arenaErrorEvent({
        pipeline: config.label,
        workspace,
        message,
        turn,
        runId,
        timestamp: this.deps.clock.now(),
      }),
    );
    channel.push(
      completeEvent({
        pipeline: config.label,
        workspace,
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
