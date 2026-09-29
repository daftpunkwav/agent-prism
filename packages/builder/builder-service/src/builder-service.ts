/**
 * @file builder-service
 * @description Agent Builder use cases: catalog, sessions, hot-swap, and chat turns.
 *
 * Responsibilities:
 * - Expose the block catalog assembled from live registries
 * - Manage session lifecycle and composition hot-swaps (with model-facing notices)
 * - Stream chat turns, merging trace entries and arena events onto one SSE chunk flow
 * - Own per-session execution guards (one turn at a time) and abort
 *
 * Orchestration only: depends on ports and domain modules; all IO (session
 * persistence and the trace journal) flows through injected store ports.
 */

import type {
  AskUserQuestion,
  BuilderCatalog,
  BuilderComposition,
  BuilderCreateRequest,
  BuilderEndpointBlock,
  BuilderPatchRequest,
  BuilderSessionDetail,
  BuilderSessionView,
  BuilderStreamChunk,
  BuilderSwapResult,
  Clock,
  ContextTuning,
  DriverLookup,
  HarnessLevel,
  IdGenerator,
  RunAttachment,
  MemoryServicePort,
  SessionEntry,
  SessionKind,
  SessionListFilter,
  SessionRecord,
  ToolDefinition,
  ArenaEvent,
} from "@agentprism/contracts";
import { BUILDER_MESSAGE_MAX_CHARS, clampToolRoundsForWire, extractToolRounds, sanitizeErrorMessage } from "@agentprism/contracts";
import { AskUserChannel, WorkspaceRegistry } from "@agentprism/runtime";
import type { BuilderMcpServerConfig } from "@agentprism/builder-turns";
import { buildBuilderCatalog, type BuilderCatalogSources, type BuilderCustomBlock } from "@agentprism/builder-turns";
import {
  buildNoToolsNotice,
  buildSwapNotice,
  diffComposition,
  normalizeComposition,
  validateComposition,
} from "@agentprism/builder-turns";
import { BuilderError } from "@agentprism/builder-turns";
import { BuilderSessionStore, type BuilderSessionRecord } from "./builder-session-store.js";
import { SessionTraceLog } from "@agentprism/builder-turns";
import { COMPACT_HANDOFF_SYSTEM } from "./prompts.js";
import { SessionTraceStore } from "./session-trace-store.js";
import {
  BUILDER_PIPELINE_LABEL,
  compositionToPipelineConfig,
  runBuilderTurn,
  type BuilderModelRuntimeFactory,
  type BuilderTurnOutput,
} from "@agentprism/builder-turns";

/**
 * Execution-ledger port (structural mirror of the SessionService lifecycle).
 * Satisfied structurally by SessionService with no package edge, keeping the
 * builder-service boundary (contracts/persistence/runtime/builder-turns/
 * environment/telemetry) intact.
 */
export interface BuilderSessionLedger {
  startSession(kind: SessionKind, title: string, metadata?: SessionRecord["metadata"]): Promise<SessionRecord>;
  completeSession(id: string, summary?: string, metadata?: SessionRecord["metadata"]): Promise<SessionRecord>;
  cancelSession(id: string, reason?: string): Promise<SessionRecord>;
  failSession(id: string, reason: string): Promise<SessionRecord>;
  /** Read surface for the session_query tool (ledger stays the source of truth). */
  listSessions(filter?: SessionListFilter): Promise<readonly SessionRecord[]>;
  getSession(id: string): Promise<{ record: SessionRecord; entries: readonly SessionEntry[] } | null>;
}

export interface BuilderServiceDeps {
  store: BuilderSessionStore;
  /** Per-session observability journal (trace entries, arena events, turn markers). */
  traceStore: SessionTraceStore;
  /** Execution ledger: every settled turn lands here (best-effort, never breaks turns). */
  sessions: BuilderSessionLedger;
  driverLookup: DriverLookup;
  modelRuntime: BuilderModelRuntimeFactory;
  workspaceRegistry: WorkspaceRegistry;
  idGenerator: IdGenerator;
  clock: Clock;
  /** Endpoint blocks for the model slot (from the live provider config). */
  endpoints: () => BuilderEndpointBlock[];
  /** Builtin tool definitions for the catalog (injected; builder-service owns no tool implementations). */
  toolDefinitions: () => readonly ToolDefinition[];
  /**
   * Registered custom-dimension blocks (injected at the composition root): one
   * palette block per dimension plus the legal values used to validate a
   * composition before it runs.
   */
  customDimensions: () => readonly BuilderCustomBlock[];
  /** Thinking capability of the effective endpoint (composition endpoint or provider default). */
  resolveThinkingCapable: (endpointId: string) => boolean;
  /** Human-channel wait in ms before ask_user degrades to headless defer (default 5min). */
  askUserWaitMs?: number;
  /** Hot runtime knobs shared with the arena runner (absent = built-in defaults). */
  contextTuning?: ContextTuning;
  toolTuning?: { subagentMaxSteps: number; ralphMaxRounds: number; mcpFetchTimeoutMs: number };
  /** Harness retry caps keyed by level token (see contracts' harnessRetryCaps). */
  harnessMaxRetries?: Partial<Record<HarnessLevel, number>>;
  /** Cross-session memory service backing the memory composition block (absent = stateless). */
  memory?: MemoryServicePort;
  /** Operator MCP servers attached when the composition enables mcp_policy. */
  mcpServers?: readonly BuilderMcpServerConfig[];
}

/** Per-session turn guard and abort registry entry. */
interface RunHandle {
  controller: AbortController;
}

/** Default human-channel wait (single source: contracts; re-exported for compat). */
export { DEFAULT_ASK_USER_WAIT_MS } from "@agentprism/contracts";

/** Agent Builder use cases: sessions, hot-swaps, chat turns, and the execution ledger. */
export class BuilderService {
  private readonly deps: BuilderServiceDeps;
  private readonly runs = new Map<string, RunHandle>();
  private readonly traces = new Map<string, SessionTraceLog>();
  /** In-flight ask_user batches keyed by session id (set only while a turn waits on the human). */
  private readonly askChannel: AskUserChannel;

  /**
   * Ledger writes are best-effort: a sick ledger (full disk, store cap) must
   * degrade to a warning, never break the turn it observes (arena parity).
   */
  private async safeLedger<T>(action: string, task: () => Promise<T>): Promise<T | null> {
    try {
      return await task();
    } catch (error) {
      console.warn(
        `[builder] session ledger ${action} failed, continuing turn: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  constructor(deps: BuilderServiceDeps) {
    this.deps = deps;
    this.askChannel = new AskUserChannel({ waitMs: deps.askUserWaitMs });
  }

  /** The block palette (frameworks, endpoints, tools, capability blocks). */
  catalog(): BuilderCatalog {
    return buildBuilderCatalog(this.catalogSources());
  }

  /** Creates a session; the composition validates against the live block palette. */
  createSession(request: BuilderCreateRequest): BuilderSessionView {
    // Omitted tools fall back to the schema working set (a fresh agent can use
    // files and execution immediately); only an explicit empty list stays
    // tool-free. A side benefit: partial patches no longer silently wipe tools
    // to empty, they fall back to the same working set instead.
    const composition = normalizeComposition(request.composition);
    this.assertCompositionAvailable(composition);
    const record = this.deps.store.create(request.name, composition);
    this.traceLogFor(record.id).append(
      "session",
      `Session created · framework=${composition.framework} · tools=${describeTools(composition)}`,
      { composition },
    );
    return this.deps.store.view(record);
  }

  /** Lists sessions oldest-first. */
  listSessions(): BuilderSessionView[] {
    return this.deps.store.list().map((record) => this.deps.store.view(record));
  }

  /** Session view plus its persisted observability journal. */
  async getSessionDetail(id: string): Promise<BuilderSessionDetail> {
    const record = this.deps.store.get(id);
    return {
      session: this.deps.store.view(record),
      records: await this.deps.traceStore.read(id),
    };
  }

  /**
   * Hot-swaps composition blocks between turns. The swap is recorded into the
   * trace and announced to the agent via a queued system-prompt notice, so the
   * next turn both uses and perceives the new blocks while keeping full history.
   */
  patchComposition(id: string, request: BuilderPatchRequest): BuilderSwapResult {
    const record = this.deps.store.get(id);
    if (typeof request.name === "string") {
      this.deps.store.rename(id, request.name);
    }
    if (request.composition === undefined) {
      return { changed_fields: [], tools_added: [], tools_removed: [], composition: record.composition };
    }
    this.assertIdle(record);
    const before = record.composition;
    const after = normalizeComposition({ ...before, ...request.composition });
    this.assertCompositionAvailable(after);

    const diff = diffComposition(before, after);
    this.deps.store.updateComposition(id, after);

    const notice = buildSwapNotice(diff, after);
    if (notice !== null) {
      this.deps.store.queueNotice(id, notice);
      this.traceLogFor(id).append("swap", `Hot-swap: ${diff.changedFields.join(", ")}`, {
        changed_fields: diff.changedFields,
        tools_added: diff.toolsAdded,
        tools_removed: diff.toolsRemoved,
        before,
        after,
      });
    }
    return {
      changed_fields: diff.changedFields,
      tools_added: diff.toolsAdded,
      tools_removed: diff.toolsRemoved,
      composition: after,
    };
  }

  /** Deletes a session (refuses while running) and clears its observability journal. */
  deleteSession(id: string): void {
    this.assertIdle(this.deps.store.get(id));
    this.deps.store.delete(id);
    this.traces.delete(id);
    void this.deps.traceStore.delete(id);
    // The store only schedules a debounced flush: force it so a crash in the next 300ms
    // cannot resurrect a session the user just deleted.
    void this.deps.store.flushNow();
  }

  /** Aborts the in-flight turn; returns whether a turn was actually running. */
  abortTurn(id: string): boolean {
    const handle = this.runs.get(id);
    if (handle === undefined) return false;
    handle.controller.abort();
    return true;
  }

  /**
   * Pending ask_user questions for one session (copies; empty when none waiting).
   * @throws BuilderError 404 on unknown sessions (matches the detail route).
   */
  pendingAsk(id: string): AskUserQuestion[] {
    // 404 on unknown sessions (matches the detail route) before the channel lookup.
    this.deps.store.get(id);
    return this.askChannel.pendingQuestions(id);
  }

  /** Delivers one human answer to the session's pending ask_user batch.
   *
   * @returns Whether a pending question with that id was waiting.
   */
  answerQuestion(id: string, questionId: string, answer: string): boolean {
    return this.askChannel.answer(id, questionId, answer);
  }

  /**
   * Handles the `/compact` maintenance command (LLM summarization of history).
   * Exact match only; anything longer travels the normal turn path. Occupies the
   * turn slot (guards, trace, ledger) but never increments the turn counter.
   *
   * @param id Builder session id (must exist and be idle).
   * @yields Trace entries then one turn chunk (answer names the char reduction,
   *   or explains the graceful failure); history persists only on success.
   * @throws BuilderError 404 on unknown sessions, 409 on concurrent turns, 422 on
   *   empty history; provider failures propagate after the ledger fail row.
   */
  async *compactTurn(id: string): AsyncGenerator<BuilderStreamChunk> {
    const record = this.deps.store.get(id);
    this.assertIdle(record);
    if (record.history.length === 0) {
      throw BuilderError.invalid("Nothing to compact: history is empty");
    }

    const controller = new AbortController();
    this.runs.set(id, { controller });
    this.deps.store.markRunning(id, true);

    const before = record.history.reduce((sum, message) => sum + message.content.length, 0);
    const ledger = await this.safeLedger("create", () =>
      this.deps.sessions.startSession("builder", "/compact", {
        builderSession: id,
        turn: record.turnCount,
        maintenance: "compact",
      }),
    );
    const trace = this.traceLogFor(id);
    const startEntry = trace.append("session", `Compact started · ${record.history.length} messages, ${before} chars`, {
      turn: record.turnCount,
    });
    yield { stream: "trace", entry: startEntry };

    try {
      // Extractive pre-trim: the summarizer reads at most this much; older turns
      // beyond the window are dropped the same way trimToCaps would drop them.
      const transcript = record.history
        .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
        .join("\n\n")
        .slice(-60_000);
      const config = compositionToPipelineConfig(record.composition, BUILDER_PIPELINE_LABEL, {
        thinkingCapable: this.deps.resolveThinkingCapable(record.composition.endpoint_id),
        customDimensionDefaults: this.customDimensionDefaults(),
      });
      const runtime = this.deps.modelRuntime.create(config, {
        sink: () => {},
        boundToolNames: () => [],
      });
      const invoked = await runtime.llm.invoke(
        [
          { role: "system", content: COMPACT_HANDOFF_SYSTEM },
          { role: "user", content: transcript },
        ],
        { signal: controller.signal },
      );
      const summary = invoked.text.trim();
      if (summary === "") {
        trace.append("session", "Compact failed: empty summary from model", { turn: record.turnCount });
        if (ledger !== null) {
          await this.safeLedger("fail", () => this.deps.sessions.failSession(ledger.id, "compact failed"));
        }
        yield {
          stream: "turn",
          turn: {
            turn: record.turnCount,
            runId: this.deps.idGenerator.next(),
            answer: "(compact failed: empty summary from model; history unchanged)",
            metrics: null,
            workspace: record.workspaceName,
          },
        };
        return;
      }
      this.deps.store.compactHistory(id, summary);
      const after = summary.length;
      trace.append("session", `Compact completed · ${before}→${after} chars`, {
        turn: record.turnCount,
        before,
        after,
      });
      if (ledger !== null) {
        // No token metadata: invoke() usage is untrusted-shape; a zero here would lie.
        await this.safeLedger("complete", () =>
          this.deps.sessions.completeSession(ledger.id, `compacted ${before}→${after} chars`),
        );
      }
      yield {
        stream: "turn",
        turn: {
          turn: record.turnCount,
          runId: this.deps.idGenerator.next(),
          answer: `(context compacted: ${before}→${after} chars)`,
          metrics: null,
          workspace: record.workspaceName,
        },
      };
    } catch (error) {
      if (ledger !== null) {
        if (controller.signal.aborted) {
          await this.safeLedger("cancel", () => this.deps.sessions.cancelSession(ledger.id));
        } else {
          await this.safeLedger("fail", () => this.deps.sessions.failSession(ledger.id, sanitizeErrorMessage(error)));
        }
      }
      throw error;
    } finally {
      this.runs.delete(id);
      this.deps.store.markRunning(id, false);
      void this.deps.store.flushNow();
      void this.deps.traceStore.flush(id);
    }
  }

  /**
   * Streams one chat turn. Chunk order: session trace → interleaved trace/event
   * flow → turn meta. History and workspace persist only on a finished turn.
   * Exact `/compact` messages dispatch to compactTurn instead (same slot, no turn taken).
   *
   * @param id Builder session id (must exist and be idle).
   * @param message User message (length-capped; attachments ride in options).
   * @param options AbortSignal plus files seeded into freshly created workspaces only.
   * @yields Trace/event chunks during the turn, then one turn chunk (empty answer on
   *   abort/failure; history appended only on success).
   * @throws BuilderError 404/409/422 on bad session/state/input; provider failures
   *   propagate after the ledger fail row.
   */
  async *chatTurn(
    id: string,
    message: string,
    options: { signal?: AbortSignal; attachments?: readonly RunAttachment[]; language?: string } = {},
  ): AsyncGenerator<BuilderStreamChunk> {
    const record = this.deps.store.get(id);
    this.assertIdle(record);
    if (message.trim() === "/compact") {
      yield* this.compactTurn(id);
      return;
    }
    if (message.length > BUILDER_MESSAGE_MAX_CHARS) {
      throw BuilderError.invalid(`Message exceeds ${BUILDER_MESSAGE_MAX_CHARS} characters`);
    }

    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    options.signal?.addEventListener("abort", forwardAbort, { once: true });
    if (options.signal?.aborted) controller.abort();
    this.runs.set(id, { controller });
    this.deps.store.markRunning(id, true);

    // Every settled turn lands in the execution ledger (arena parity): the builder
    // kind exists in the ledger vocabulary but had no writer until now.
    const question = message.replace(/\s+/g, " ").trim();
    const ledger = await this.safeLedger("create", () =>
      this.deps.sessions.startSession("builder", question === "" ? "builder turn" : question.slice(0, 80), {
        builderSession: id,
        turn: record.turnCount + 1,
      }),
    );

    const trace = this.traceLogFor(id);
    const turn = record.turnCount + 1;
    const composition = record.composition;
    // Turn boundary marker: the journal's spine for replaying the whole trail.
    this.deps.traceStore.append(id, { kind: "turn", turn, ts: this.deps.clock.now(), user: message });

    // Notices are consumed exactly once; a tool-free composition always reminds the model.
    const notices = this.deps.store.takeNotices(id);
    if (composition.tools.length === 0) {
      notices.unshift(buildNoToolsNotice());
    }

    const startEntry = trace.append(
      "session",
      `Turn ${turn} started · framework=${composition.framework} · tools=${describeTools(composition)}`,
      { turn, message_chars: message.length, notices: [...notices], composition },
    );
    yield { stream: "trace", entry: startEntry };

    let output: BuilderTurnOutput | null = null;
    // Only pairing-relevant events are retained, the same rule the thread turn path
    // applies: extractToolRounds reads actions and observations only, so holding the
    // streamed deltas too would pin a live turn's whole transcript (~420 B per event;
    // 20 k deltas ≈ 8 MB) in a list nothing ever reads.
    const toolEvents: ArenaEvent[] = [];
    try {
      const iterator = runBuilderTurn(
        {
          driverLookup: this.deps.driverLookup,
          modelRuntime: this.deps.modelRuntime,
          workspaceRegistry: this.deps.workspaceRegistry,
          idGenerator: this.deps.idGenerator,
          clock: this.deps.clock,
          sessionsQuery: this.deps.sessions,
          contextTuning: this.deps.contextTuning,
          toolTuning: this.deps.toolTuning,
          harnessMaxRetries: this.deps.harnessMaxRetries,
          memory: this.deps.memory,
          mcpServers: this.deps.mcpServers,
          customDimensionDefaults: () => this.customDimensionDefaults(),
        },
        {
          appendTrace: (kind, title, data, appendOptions) =>
            trace.append(kind, title, data, { turn, durationMs: appendOptions?.durationMs ?? null }),
        },
        {
          sessionId: id,
          turn,
          message,
          composition,
          history: [...record.history],
          language: options.language,
          workspaceName: record.workspaceName,
          thinkingCapable: this.deps.resolveThinkingCapable(composition.endpoint_id),
          notices,
          askUser: (questions, signal) => this.askChannel.awaitAnswers(id, questions, signal),
          attachments: options.attachments,
          signal: controller.signal,
        },
      );

      try {
        while (true) {
          const next = await iterator.next();
          if (next.done) {
            output = next.value;
            break;
          }
          // Raw arena events land in the journal as they stream (full-fidelity trail).
          if (next.value.stream === "event") {
            this.deps.traceStore.append(id, { kind: "event", turn, event: next.value.event });
            if (next.value.event.type === "action" || next.value.event.type === "observation") {
              toolEvents.push(next.value.event);
            }
          }
          yield next.value;
        }
      } finally {
        // A consumer that stops early (SSE client gone) must still close the turn's
        // channel and abort its in-flight driver work instead of relying on the
        // caller's signal also being aborted.
        await iterator.return?.(undefined as never);
      }

      const result = output as BuilderTurnOutput;
      if (result.aborted) {
        trace.append("session", `Turn ${turn} aborted`, { turn });
        if (ledger !== null) {
          await this.safeLedger("cancel", () => this.deps.sessions.cancelSession(ledger.id));
        }
      } else if (result.errorSeen) {
        trace.append("session", `Turn ${turn} failed`, { turn, runId: result.runId });
        if (ledger !== null) {
          await this.safeLedger("fail", () => this.deps.sessions.failSession(ledger.id, "builder turn failed"));
        }
      } else {
        const answer = result.answer.slice(0, BUILDER_MESSAGE_MAX_CHARS) || "(no reply)";
        // Same clamp as the client capture path: a stored turn can never outgrow
        // the wire budget, whichever mode renders it later.
        this.deps.store.appendTurn(id, message, answer, result.workspaceName, turn, clampToolRoundsForWire(extractToolRounds(toolEvents)));
        trace.append("session", `Turn ${turn} completed · ${result.metrics?.total_tokens ?? 0} tokens`, {
          turn,
          runId: result.runId,
          workspace: result.workspaceName,
          metrics: result.metrics,
        });
        if (ledger !== null) {
          await this.safeLedger("complete", () =>
            this.deps.sessions.completeSession(ledger.id, answer.slice(0, 200), {
              total_tokens: result.metrics?.total_tokens ?? 0,
            }),
          );
        }
      }
      yield {
        stream: "turn",
        turn: {
          turn,
          runId: result.runId,
          answer: result.aborted || result.errorSeen ? "" : result.answer,
          metrics: result.metrics,
          workspace: result.workspaceName,
        },
      };
    } catch (error) {
      // Escaping throws are rare (turn failures surface as errorSeen above):
      // still close the ledger, then let the failure propagate unchanged.
      if (ledger !== null) {
        if (controller.signal.aborted) {
          await this.safeLedger("cancel", () => this.deps.sessions.cancelSession(ledger.id));
        } else {
          await this.safeLedger("fail", () => this.deps.sessions.failSession(ledger.id, sanitizeErrorMessage(error)));
        }
      }
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", forwardAbort);
      this.runs.delete(id);
      this.deps.store.markRunning(id, false);
      void this.deps.store.flushNow();
      // Turn-end durability for the journal (also awaited implicitly by detail reads).
      void this.deps.traceStore.flush(id);
    }
  }

  /**
   * Effective default per registered custom dimension (declared, else first
   * option): the value a run applies when the composition holds no explicit
   * choice, matching what the palette shows.
   */
  private customDimensionDefaults(): Readonly<Record<string, string>> {
    return Object.fromEntries(
      this.deps.customDimensions().map((dimension) => [dimension.id, dimension.default]),
    );
  }

  /** Availability sources against the live registries (never a static snapshot). */
  private catalogSources(): BuilderCatalogSources {
    return {
      frameworks: () => [
        ...this.deps.driverLookup.listAvailable().map((driver) => ({ ...driver, reason: "" })),
        ...this.deps.driverLookup.listReserved(),
      ],
      endpoints: () => this.deps.endpoints(),
      tools: () => this.deps.toolDefinitions(),
      customDimensions: () => this.deps.customDimensions(),
    };
  }

  /** Trace log registry: one entry factory per session, journal-backed via onAppend. */
  private traceLogFor(id: string): SessionTraceLog {
    let trace = this.traces.get(id);
    if (trace === undefined) {
      trace = new SessionTraceLog({
        idGenerator: this.deps.idGenerator,
        clock: this.deps.clock,
        onAppend: (entry) => this.deps.traceStore.append(id, { kind: "trace", entry }),
      });
      this.traces.set(id, trace);
    }
    return trace;
  }

  private assertIdle(record: BuilderSessionRecord): void {
    if (record.running || this.runs.has(record.id)) {
      throw BuilderError.conflict("A turn is already running for this session");
    }
  }

  private assertCompositionAvailable(composition: BuilderComposition): void {
    const sources = this.catalogSources();
    validateComposition(composition, {
      availableFrameworks: sources.frameworks()
        .filter((framework) => framework.status === "available")
        .map((framework) => framework.id),
      knownTools: sources.tools().map((definition) => definition.name),
      knownEndpointIds: sources.endpoints().map((endpoint) => endpoint.id),
      customDimensionValues: Object.fromEntries(
        sources.customDimensions().map((dimension) => [dimension.id, dimension.options.map((option) => option.value)]),
      ),
    });
  }
}

function describeTools(composition: { tools: string[] }): string {
  return composition.tools.length > 0 ? composition.tools.join("+") : "none";
}
