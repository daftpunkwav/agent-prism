/**
 * @file turn-runner
 * @description Runs one builder chat turn: compose, execute, and observe.
 *
 * Responsibilities:
 * - Map the session composition onto a run (driver + PipelineConfig + runtime)
 * - Pump arena events and LLM wire captures onto one ordered chunk channel
 * - Extract the final answer from the event stream (shared arena convention)
 *
 * The runner owns no session state: inputs arrive via BuilderTurnInput, results
 * return as the generator's completion value; the service layer persists them.
 */

import { runAgentExecution, type AgentRunSpec } from "@agentprism/agent";
import { extractFinalAnswer } from "@agentprism/arena-view";
import type {
  ArenaEvent,
  BuilderStreamChunk,
  BuilderTraceEntry,
  ChatMessage,
  Clock,
  ColumnRuntime,
  DriverLookup,
  IdGenerator,
  MemoryServicePort,
  LlmWireRecord,
  PipelineConfig,
  PipelineMetrics,
  RunAttachment,
  AskUserRespond,
} from "@agentprism/contracts";
import { sanitizeErrorMessage } from "@agentprism/contracts";
import { EventChannel, type WorkspaceRegistry } from "@agentprism/runtime";
import type { BuilderComposition, SessionQueryPort } from "@agentprism/contracts";
import { compositionToPipelineConfig } from "./composition.js";

/** Aggregation label of builder runs (event pipeline key, stable across turns). */
export const BUILDER_PIPELINE_LABEL = "builder";

/** Event retention per turn for answer extraction (fail-safe cap; extraction needs only the tail). */
const MAX_TURN_EVENTS = 800;

/** Receive-poll cadence while waiting for pump chunks. */
const CHANNEL_POLL_MS = 1_000;

/** Trace kinds the runner emits (session lifecycle + LLM wire traffic). */
export type TurnTraceKind = "llm_request" | "llm_response" | "llm_error" | "session";

/**
 * Port: builds the model runtime for one turn. Implementations attach wire
 * capture (LLM request/response tracing) at model construction so every driver
 * — native, LangChain, LangGraph — is observed without driver changes.
 */
export interface BuilderModelRuntimeFactory {
  create(
    config: PipelineConfig,
    wire: { sink: (record: LlmWireRecord) => void; boundToolNames: () => string[] },
  ): ColumnRuntime;
}

/**
 * Structural ContextTuning (harness dep deliberately avoided here): mirrors the
 * harness tuning knobs field-for-field so the builder never imports execution
 * packages; every field is optional, so the mirror stays assignable both ways.
 */
export interface BuilderContextTuning {
  windowSize?: number;
  charsPerToken?: number;
  summaryMaxChars?: number;
  tokenBudgetChars?: number;
  tokenBudgetKeepTurns?: number;
  toolTailBudgetChars?: number;
  toolTailKeepChars?: number;
  budgetTokens?: number;
  compactTargetTokens?: number;
}

/** Structural MCP server config (tool-mcp dep deliberately avoided here). */
export interface BuilderMcpServerConfig {
  command: string;
  args?: readonly string[];
  env?: Record<string, string>;
  timeoutMs?: number;
  tools?: readonly string[];
}

export interface BuilderTurnDeps {
  driverLookup: DriverLookup;
  modelRuntime: BuilderModelRuntimeFactory;
  workspaceRegistry: WorkspaceRegistry;
  idGenerator: IdGenerator;
  clock: Clock;
  /** Read-only session query port for the session_query tool (absent = placeholder). */
  sessionsQuery?: SessionQueryPort;
  /** Hot runtime knobs shared with the arena runner (absent = built-in defaults). */
  contextTuning?: BuilderContextTuning;
  toolTuning?: { subagentMaxSteps: number; ralphMaxRounds: number; mcpFetchTimeoutMs: number };
  harnessMaxRetries?: { verify?: number; reflect?: number; selfEvolve?: number };
  /** Cross-session memory service backing the memory composition block (absent = stateless). */
  memory?: MemoryServicePort;
  /** Operator MCP servers attached when the composition enables mcp_policy. */
  mcpServers?: readonly BuilderMcpServerConfig[];
}

export interface BuilderTurnInput {
  /** Stable session identity: events carry it as agentId. */
  sessionId: string;
  turn: number;
  message: string;
  composition: BuilderComposition;
  /** Prior turns' history (user/assistant pairs); this turn's message is not included. */
  history: ChatMessage[];
  /** Prior turn's workspace name; reused when still resident. */
  workspaceName?: string;
  thinkingCapable: boolean;
  /** Session notices rendered into this turn's system prompt (hot-swap, no-tools). */
  notices: readonly string[];
  /** Live ask_user channel (absent = ask_user records and defers headlessly). */
  askUser?: AskUserRespond;
  /** Files seeded into a newly created workspace (fresh sessions only, arena parity). */
  attachments?: readonly RunAttachment[];
  signal?: AbortSignal;
}

/** Completion value of a finished turn (consumed by the service to persist state). */
export interface BuilderTurnOutput {
  answer: string;
  runId: string;
  workspaceName: string;
  metrics: PipelineMetrics | null;
  aborted: boolean;
  errorSeen: boolean;
}

export interface BuilderTurnHooks {
  /** Appends a trace entry to the session log and returns it for stream delivery. */
  appendTrace(
    kind: TurnTraceKind,
    title: string,
    data: Record<string, unknown>,
    options?: { durationMs?: number | null },
  ): BuilderTraceEntry;
}

/**
 * Runs one turn and streams chunks (trace + arena events) until completion.
 * Resolves to BuilderTurnOutput once the turn settles.
 *
 * @param deps Driver lookup, model runtime, workspace registry, ids, clock.
 * @param hooks Trace sink receiving every turn-scoped entry.
 * @param input Session id, 1-based turn, message, composition, prior history,
 *   reusable workspace name, thinking support, notices, attachments, and signal.
 * @yields Trace chunks, arena event chunks, and terminal turn-event eviction notes.
 * @returns Settled output: answer (empty on abort/failure), run/workspace ids,
 *   metrics, and abort/error flags for the service persist step.
 */
export async function* runBuilderTurn(
  deps: BuilderTurnDeps,
  hooks: BuilderTurnHooks,
  input: BuilderTurnInput,
): AsyncGenerator<BuilderStreamChunk, BuilderTurnOutput> {
  const channel = new EventChannel<BuilderStreamChunk | null>();
  const internalAbort = new AbortController();
  const forwardAbort = () => internalAbort.abort();
  input.signal?.addEventListener("abort", forwardAbort, { once: true });
  if (input.signal?.aborted) internalAbort.abort();

  /** Appends to the session trace log and forwards the entry onto the chunk channel. */
  const emitTrace = (
    kind: TurnTraceKind,
    title: string,
    data: Record<string, unknown>,
    durationMs: number | null = null,
  ): void => {
    const entry = hooks.appendTrace(kind, title, data, { durationMs });
    channel.push({ stream: "trace", entry });
  };

  let resolveOutput: (output: BuilderTurnOutput) => void = () => {};
  const outputPromise = new Promise<BuilderTurnOutput>((resolve) => {
    resolveOutput = resolve;
  });

  const pump = (async (): Promise<void> => {
    let runId = "";
    try {
      const driver = deps.driverLookup.get(input.composition.framework);
      const config = compositionToPipelineConfig(input.composition, BUILDER_PIPELINE_LABEL, {
        thinkingCapable: input.thinkingCapable,
      });
      const boundToolNames = [...input.composition.tools];
      const runtime = deps.modelRuntime.create(config, {
        sink: (record) => emitTrace(record.kind, record.title, record.data, record.durationMs),
        boundToolNames: () => [...boundToolNames],
      });
      runId = deps.idGenerator.next();

      const spec: AgentRunSpec = {
        driver,
        config,
        question: input.message,
        history: input.history,
        turn: input.turn,
        agentId: input.sessionId,
        runId,
        columnRuntime: runtime,
        existingWorkspaceName: input.workspaceName,
        toolNames: boundToolNames,
        sessions: deps.sessionsQuery,
        contextTuning: deps.contextTuning,
        toolTuning: deps.toolTuning,
        harnessMaxRetries: deps.harnessMaxRetries,
        memory: deps.memory,
        mcpServers: input.composition.mcp_policy !== "off" ? deps.mcpServers : undefined,
        askUser: input.askUser,
        attachments: input.attachments,
        notices: input.notices,
        systemPromptOverride:
          input.composition.system_prompt.trim() === "" ? undefined : input.composition.system_prompt,
        signal: internalAbort.signal,
      };

      const events: ArenaEvent[] = [];
      for await (const event of runAgentExecution(
        { workspaceRegistry: deps.workspaceRegistry, idGenerator: deps.idGenerator, clock: deps.clock },
        spec,
      )) {
        events.push(event);
        // Terminal complete/error events and the final answer live at the tail: evict from
        // the head, never the tail. Keeping the first N instead would lose the terminal
        // complete on long turns (thought_delta streams per chunk), misreporting a finished
        // turn as failed and extracting a stale mid-run answer.
        if (events.length > MAX_TURN_EVENTS) events.splice(0, events.length - MAX_TURN_EVENTS);
        channel.push({ stream: "event", event });
      }

      const complete = [...events].reverse().find((event) => event.type === "complete");
      resolveOutput({
        answer: extractFinalAnswer(events, input.turn),
        runId,
        workspaceName: complete?.workspace ?? input.workspaceName ?? "",
        metrics: complete?.metrics ?? null,
        aborted: internalAbort.signal.aborted,
        errorSeen: complete === undefined || events.some((event) => event.type === "error"),
      });
    } catch (error) {
      const message = sanitizeErrorMessage(error);
      emitTrace("session", `Turn failed: ${message.slice(0, 200)}`, { error: message });
      channel.push({ stream: "error", message, fatal: true });
      resolveOutput({
        answer: "",
        runId,
        workspaceName: input.workspaceName ?? "",
        metrics: null,
        aborted: internalAbort.signal.aborted,
        errorSeen: true,
      });
    } finally {
      channel.push(null);
    }
  })();

  try {
    while (true) {
      const item = await channel.receive(CHANNEL_POLL_MS);
      if (item.kind === "closed") break;
      if (item.kind === "timeout") continue;
      if (item.value === null) break;
      yield item.value;
    }
    return await outputPromise;
  } finally {
    input.signal?.removeEventListener("abort", forwardAbort);
    // A consumer that broke early must stop the driver; aborting after a normal
    // finish is a no-op for completed work.
    internalAbort.abort();
    channel.close();
    await pump.catch(() => {});
  }
}
