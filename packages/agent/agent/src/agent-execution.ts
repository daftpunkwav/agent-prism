/**
 * @file agent-execution
 * @description Runs one agent execution end-to-end inside an isolated workspace.
 *
 * Responsibilities:
 * - Inject the execution context (tools, prompts, verification) into the driver
 * - Execute the driver run wrapped in verification
 * - Host delegation spawn hooks (subagent spawn/fork, ralph_loop rounds, scatter fan-out)
 * - Stamp events with run/execution ids and converge failures into error events
 * - Release the workspace protection mark on both success and failure (the directory
 *   itself is kept: follow-up turns and restart recovery read it back from disk)
 *
 * Agent-layer module: depends on runtime/tools/harness/telemetry abstractions, never on UI.
 * Drivers are consumed only through the contracts AgentDriver port (dependency inversion);
 * this package never imports a driver implementation. Tool-surface assembly (registry
 * filtering, live tool wrappers, guarded execute path) lives in ./tool-access.js.
 */

import {
  sanitizeErrorMessage,
  type AgentDriver,
  type ArenaEvent,
  type AskUserRespond,
  type ChatMessage,
  type Clock,
  type ColumnRuntime,
  type IdGenerator,
  type HarnessLevel,
  type MemoryRecallResult,
  type MemoryServicePort,
  type PipelineConfig,
  type SessionQueryPort,
} from "@agentprism/contracts";
import { arenaErrorEvent, completeEvent, extractAnswerFromEvents, isPipelineConfigBanner, majorityVote, type RunAttachment } from "@agentprism/contracts";
import {
  createContextAnalytics,
  RagStoreCache,
  runVerificationLoop,
  summarizeAnalytics,
  finalizeStructuredAnswer,
  type AgentExecutionContext,
  type ContextTuning,
} from "@agentprism/harness";
import { WorkspaceRegistry } from "@agentprism/runtime";
import { buildMetrics, TokenTracker } from "@agentprism/telemetry";
import { renderHistoryForMode } from "./history-render.js";
import {
  GOAL_STORE_FILE,
  PLAN_STORE_FILE,
  RALPH_HANDOFF_CHARS,
  RALPH_TOOL_NAME,
  effectiveSkills,
  renderBundledSkillsBlock,
  SCATTER_MAX_CONCURRENCY,
  SCATTER_TOOL_NAME,
  SUBAGENT_MAX_STEPS,
  SUBAGENT_TOOL_NAME,
} from "@agentprism/tool-builtins";
import {
  McpClient,
  NodeMcpTransport,
  registerRemoteMcpTools,
  type McpServerConfig,
  type McpTransport,
} from "@agentprism/tool-mcp";
import { selectToolNames } from "@agentprism/tool-registry";
import { resolveRunWorkspace } from "./run-workspace.js";
import { buildToolAccess, type AgentToolTuning, type RalphSpawn, type ScatterSpawn, type SubagentSpawn } from "./tool-access.js";

// Spawn hook types stay on the agent public surface (moved to ./tool-access.js).
export type { AgentToolTuning, RalphSpawn, ScatterSpawn, SubagentSpawn } from "./tool-access.js";

/** Runner dependencies: only infrastructure abstractions; framework-agnostic. */
export interface AgentExecutionDeps {
  workspaceRegistry: WorkspaceRegistry;
  idGenerator: IdGenerator;
  clock: Clock;
  /** Cross-session memory service (absent = stateless runs, no recall/record). */
  memory?: MemoryServicePort;
}

/** Full input of one column run. */
export interface AgentRunSpec {
  driver: AgentDriver;
  config: PipelineConfig;
  question: string;
  history: ChatMessage[];
  turn: number;
  agentId: string;
  runId: string;
  columnRuntime: ColumnRuntime;
  /** Prior turn's workspace name; reused when still resident in the registry. */
  existingWorkspaceName?: string;
  /** Files seeded into the workspace when this run creates one (follow-up reuse skips seeding). */
  attachments?: readonly RunAttachment[];
  /**
   * Explicit tool-name override (builder sessions). When present it replaces the
   * toolset mapping entirely; an empty array means the agent runs with no tools.
   * Unknown names are dropped (fail-closed), never silently broadened.
   */
  toolNames?: readonly string[];
  /** Nesting depth of subagent delegation (0 for top-level runs; capped internally). */
  subagentDepth?: number;
  /**
   * Operator MCP server configs (external processes). Attached top-level only:
   * nested runs inherit files, not server processes. Absent means none.
   */
  mcpServers?: readonly McpServerConfig[];
  /** MCP transport override (tests inject an in-process duplex; production spawns real servers). */
  mcpTransport?: McpTransport;
  /** Read-only session query port (absent = session_query stays placeholder). */
  sessions?: SessionQueryPort;
  /**
   * Live ask_user channel (absent = ask_user stays headless record-and-defer).
   * Top-level only by default: nested runs deliberately do not inherit it,
   * because their events are consumed inside the parent and a question would
   * have no UI to pop. Set propagateAskUser to opt nested runs into the live
   * channel explicitly.
   */
  askUser?: AskUserRespond;
  /** Opt nested runs into the live ask_user channel (default false). */
  propagateAskUser?: boolean;
  /** Session-level notices rendered into the system prompt (hot-swap announcements). */
  notices?: readonly string[];
  /** Custom system prompt block; replaces the profile section when non-empty. */
  systemPromptOverride?: string;
  /** Operator-tuned context strategy budgets; absent fields keep built-in defaults. */
  contextTuning?: ContextTuning;
  /** Operator-tuned harness retry caps per level; absent fields keep built-in defaults. */
  harnessMaxRetries?: Partial<Record<HarnessLevel, number>>;
  /** Operator-tuned delegation/fetch knobs; absent fields keep built-in defaults. */
  toolTuning?: AgentToolTuning;
  /** Delegation ceiling for subagent spawning (default 1: parent -> child only). */
  maxDelegationDepth?: number;
  /** Cross-session memory service override (falls back to deps.memory; absent = stateless). */
  memory?: MemoryServicePort;
  signal?: AbortSignal;
}

/** Delegation ceiling: parent -> child only (a child never sees delegation tools). */
const MAX_DELEGATION_DEPTH = 1;

/** Memory policy token from the pipeline config (absent = stateless). */
function memoryPolicyOf(config: PipelineConfig): string {
  return config.memory ?? "none";
}

/** Whether the policy token names a known memory layer (unknown tokens fail closed to stateless). */
function isKnownMemoryPolicy(policy: string): boolean {
  return policy === "episodic" || policy === "semantic" || policy === "full";
}

/**
 * Recalls cross-session memories for a top-level run (best-effort: failures
 * warn and resolve to undefined so the run stays stateless, never fails).
 */
async function recallMemoryForRun(
  memory: MemoryServicePort | undefined,
  policy: string,
  question: string,
): Promise<MemoryRecallResult | undefined> {
  if (memory === undefined || !isKnownMemoryPolicy(policy)) return undefined;
  try {
    if (policy === "episodic") {
      const episodic = await memory.recallEpisodic(question, { limit: 3 });
      return { episodic: [...episodic], semantic: [] };
    }
    if (policy === "semantic") {
      const semantic = await memory.recallSemantic(question, { limit: 5 });
      return { episodic: [], semantic: [...semantic] };
    }
    return await memory.recallAll(question, { limit: 3 });
  } catch (error) {
    console.warn(`[agent] memory recall skipped: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/**
 * Settles one episodic experience into memory (best-effort: never fails the run).
 */
async function recordEpisodicExperience(
  memory: MemoryServicePort | undefined,
  policy: string,
  entry: { task: string; framework: string; model: string; success: boolean; keyActions: string[]; lessons: string },
): Promise<void> {
  if (memory === undefined || !isKnownMemoryPolicy(policy)) return;
  try {
    await memory.recordEpisodic({ ...entry, workspaceTag: "" });
  } catch (error) {
    console.warn(`[agent] memory record skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Machine-read STATUS line; only this line is parsed, the rest rides as free text. */
function parseRalphStatus(answer: string): "continue" | "complete" | "blocked" | null {
  const match = answer.match(/^STATUS:\s*(continue|complete|blocked)\s*$/im);
  if (match === null) return null;
  return (match[1] as string).toLowerCase() as "continue" | "complete" | "blocked";
}

// Shared implementation lives in contracts (also consumed by drivers for
// self-consistency); re-exported here for the scatter vote strategy's callers.
export { majorityVote };

/**
 * Attaches external MCP servers to a column registry (top-level runs only).
 * Each server connects best-effort: a dead server warns and skips, never fails
 * the run it was meant to serve. Returns live clients the caller must close.
 */
export async function attachRemoteMcpServers(
  registry: import("@agentprism/contracts").ToolRegistry,
  servers: readonly McpServerConfig[],
  transport: McpTransport = new NodeMcpTransport(),
  options: { roots?: readonly string[] } = {},
): Promise<McpClient[]> {
  const clients: McpClient[] = [];
  let index = 0;
  for (const server of servers) {
    index += 1;
    try {
      const client = await McpClient.connect(transport, server, { roots: options.roots });
      clients.push(client);
      await registerRemoteMcpTools(registry, client, `ext${index}`, server.tools);
    } catch (error) {
      console.warn(`[agent] external MCP server #${index} skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return clients;
}

/**
 * Stamps flow identity onto an event (copies, never mutates the input).
 * turn 0 is the "unset" sentinel (turns are 1-based: the runner derives the turn from
 * history length), so only a missing turn is backfilled. timestamp is always the emission
 * time, overriding any driver-set value, so downstream ordering uses one clock reading per event.
 */
function stampEvent(
  event: ArenaEvent,
  label: string,
  turn: number,
  agentId: string,
  runId: string,
  timestamp: number,
): ArenaEvent {
  const stamped: ArenaEvent = { ...event };
  if (stamped.pipeline !== label) stamped.pipeline = label;
  // The contract reserves 0 for "unannotated"; hand-rolled drivers may also
  // omit the field entirely (typed as number, absent at runtime). Both cases
  // backfill so turn scoping and answer extraction never lose the event.
  if (stamped.turn === 0 || (stamped.turn as number | undefined) === undefined) stamped.turn = turn;
  stamped.agentId = agentId;
  stamped.runId = runId;
  stamped.timestamp = timestamp;
  return stamped;
}

/**
 * One agent instance's full execution lifecycle with a shared verification loop
 * around driver.run (Native / LangChain / LangGraph share one semantic).
 *
 * @param deps Infrastructure only (workspace registry, ids, clock); framework-agnostic.
 * @param spec Full run input: driver, pipeline config, question/history, toolset selection,
 *   delegation depth, and abort signal.
 * @yields ArenaEvents stamped with run/execution identity, ending in exactly one
 *   terminal complete (plus an error event first when the run fails).
 */
export async function* runAgentExecution(
  deps: AgentExecutionDeps,
  spec: AgentRunSpec,
): AsyncGenerator<ArenaEvent> {
  const label = spec.config.label || spec.driver.displayName;
  const { workspace, name: workspaceName, reused: workspaceReused } = resolveRunWorkspace(deps.workspaceRegistry, {
    question: spec.question,
    label,
    runId: spec.runId,
    clock: deps.clock,
    idGenerator: deps.idGenerator,
    existingName: spec.existingWorkspaceName,
  });
  // The traces for this run land under its own runId while a reused workspace's
  // root stays under the FIRST run's directory; the marker is the disk-level
  // link the logs read side merges across turns on.
  deps.workspaceRegistry.associateTrace(spec.runId, workspaceName);
  const tracker = new TokenTracker({
    contextWindow: spec.columnRuntime.contextWindow,
    maxInputTokens: spec.columnRuntime.maxInputTokens,
    maxOutputTokens: spec.config.max_output_tokens,
  });
  const ragCache = new RagStoreCache();
  const started = deps.clock.now();
  // Object wrapper instead of a plain string: the verification loop publishes review feedback
  // by reference while the execution context exposes it through a getter below.
  const feedback = { text: "" };
  // Declared outside try: the catch path reports the same observed workload (a failed run
  // still counts the steps and tool calls attempted before the failure).
  let observedSteps = 0;
  let observedToolCalls = 0;
  // Declared outside try: the catch path settles the same episodic post-mortem
  // (a failed top-level run still teaches later sessions) and the finally below
  // always closes attached servers, even when the run fails before the driver loop.
  let remoteClients: McpClient[] = [];
  const memoryService = spec.memory ?? deps.memory;
  const memoryPolicy = memoryPolicyOf(spec.config);
  const subagentDepth = spec.subagentDepth ?? 0;

  try {
    // Seed client attachments into freshly created workspaces only; reused follow-up
    // workspaces keep the files the agent already wrote. Inside the try so a seed
    // failure flows through the error path and the finally still unprotects.
    if (!workspaceReused && spec.attachments && spec.attachments.length > 0) {
      for (const file of spec.attachments) {
        workspace.fs.writeFile(file.name, file.content);
      }
    }
    // Orchestration discipline seeding (fresh workspaces only; reused follow-ups
    // keep the plan/goal the agent already wrote). Best-effort: a seed failure
    // must never fail the run it was meant to discipline.
    const orchestration = (spec.config as Record<string, unknown>)["orchestration"];
    if (!workspaceReused && orchestration !== undefined) {
      try {
        if (orchestration === "plan_first" && !workspace.fs.exists(PLAN_STORE_FILE)) {
          workspace.fs.writeFile(
            PLAN_STORE_FILE,
            `# Plan\n\n- Objective: ${spec.question.slice(0, 200)}\n- Steps: [propose the sequenced approach with the plan tool, then execute it]\n- Verification: [how the outcome will be checked]\n`,
          );
        } else if (orchestration === "goal_first" && !workspace.fs.exists(GOAL_STORE_FILE)) {
          workspace.fs.writeFile(
            GOAL_STORE_FILE,
            `${JSON.stringify({ objective: spec.question.slice(0, 500), criteria: [], status: "active", detail: "" }, null, 2)}\n`,
          );
        }
      } catch {
        // Seed failures stay silent: the orchestration prompt note still disciplines the run.
      }
    }
    // Delegation: the child shares the workspace (files stay visible to the parent).
    // (subagentDepth is hoisted above the try so the catch path shares it.)
    /**
     * Runs one nested delegation turn sharing this workspace: spawn uses blank
     * history, fork inherits the parent transcript plus the subtask as a new
     * user turn. The caller toolset minus the withheld delegation tools (no
     * privilege change: depth 1 cannot re-delegate), capped steps. Token cost
     * folds into the parent tracker so run totals stay honest; nested events
     * are consumed here, never re-yielded. Abort rethrows (parity with direct
     * tools); turn failures return a failure message instead of throwing.
     *
     * @param task Self-contained subtask text (becomes the nested question).
     * @param maxSteps Caller-side step cap, clamped against the parent config.
     * @param agentSuffix Identity suffix for tracing ("/sub", "/ralph-N").
     * @param excludeTools Tool names withheld from the nested registry (anti-regress).
     * @param inheritedHistory Parent transcript for fork mode (spawn passes []).
     * @returns Settled answer text, or a failure message (never throws for turn failures).
     */
    const runNested = async (
      task: string,
      maxSteps: number,
      agentSuffix: string,
      excludeTools: readonly string[],
      inheritedHistory: ChatMessage[] = [],
    ): Promise<{ answer: string; failure: string | null }> => {
      const nestedToolNames = (spec.toolNames ?? selectToolNames(spec.config.toolset)).filter(
        (name) => !excludeTools.includes(name),
      );
      const nestedEvents: ArenaEvent[] = [];
      for await (const event of runAgentExecution(deps, {
        ...spec,
        question: task,
        history: inheritedHistory,
        toolNames: nestedToolNames,
        existingWorkspaceName: workspaceName,
        attachments: undefined,
        notices: undefined,
        subagentDepth: subagentDepth + 1,
        agentId: `${spec.agentId}${agentSuffix}`,
        // An unlimited parent (the -1 contract sentinel; any negative value is
        // widened defensively the same way) contributes Infinity to the min so
        // the nested budget is the caller's cap, never the sentinel itself.
        config: {
          ...spec.config,
          max_steps: Math.min(
            spec.config.max_steps < 0 ? Number.POSITIVE_INFINITY : spec.config.max_steps,
            maxSteps,
          ),
        },
      })) {
        nestedEvents.push(event);
      }
      // Abort parity with direct tools (run rethrows AbortError): a cancelled
      // parent must stop, not read a failure memo and carry on.
      if (spec.signal?.aborted) {
        const aborted = new Error("Aborted");
        aborted.name = "AbortError";
        throw aborted;
      }
      for (let i = nestedEvents.length - 1; i >= 0; i -= 1) {
        const event = nestedEvents[i] as ArenaEvent;
        if (event.type === "complete" && event.metrics !== null) {
          tracker.addUsage({ inputTokens: event.metrics.input_tokens, outputTokens: event.metrics.output_tokens });
          break;
        }
      }
      const failure = nestedEvents.find((event) => event.type === "error");
      if (failure !== undefined && failure.type === "error") {
        return { answer: "", failure: failure.message };
      }
      const answer = extractAnswerFromEvents(nestedEvents);
      return answer === "" ? { answer: "(subagent returned no answer)", failure: null } : { answer, failure: null };
    };
    const maxDelegationDepth = spec.maxDelegationDepth ?? MAX_DELEGATION_DEPTH;
    const subagentSpawn: SubagentSpawn | undefined =
      subagentDepth >= maxDelegationDepth
        ? undefined
        : async (task: string, maxSteps: number, mode: "spawn" | "fork" = "spawn"): Promise<string> => {
            // Fork inherits the parent transcript so far (prior turns plus the
            // current question for grounding); the subtask rides as the child
            // question. Parent history is already bounded by the chat contract.
            const inherited: ChatMessage[] =
              mode === "fork" ? [...spec.history, { role: "user", content: spec.question }] : [];
            const nested = await runNested(task, maxSteps, "/sub", [SUBAGENT_TOOL_NAME], inherited);
            if (nested.failure !== null) return `(subagent failed: ${nested.failure})`;
            return nested.answer;
          };
    const ralphSpawn: RalphSpawn | undefined =
      subagentDepth >= maxDelegationDepth
        ? undefined
        : async (objective: string, maxRounds: number): Promise<string> => {
            let handoff = "";
            let lastAnswer = "";
            for (let round = 1; round <= maxRounds; round += 1) {
              const nested = await runNested(
                [
                  `Round ${round}/${maxRounds}. Objective: ${objective}`,
                  `Previous handoff (may be empty): ${handoff}`,
                  "Work the next concrete slice with your tools. End your reply with exactly:",
                  "STATUS: <continue|complete|blocked>",
                  "SUMMARY: <one-paragraph outcome, evidence, and next step or blocker>",
                ].join("\n"),
                spec.toolTuning?.subagentMaxSteps ?? SUBAGENT_MAX_STEPS,
                `/ralph-${round}`,
                [SUBAGENT_TOOL_NAME, RALPH_TOOL_NAME],
              );
              if (nested.failure !== null) {
                return `[ralph blocked in round ${round}]\n${nested.failure}`;
              }
              lastAnswer = nested.answer;
              handoff = lastAnswer.slice(0, RALPH_HANDOFF_CHARS);
              const status = parseRalphStatus(lastAnswer);
              if (status === "complete") return `[ralph complete after ${round} round(s)]\n${lastAnswer}`;
              if (status !== "continue") return `[ralph blocked after ${round} round(s)]\n${lastAnswer}`;
            }
            return `[ralph budget-limited after ${maxRounds} round(s)]\n${lastAnswer}`;
          };
    // Scatter fan-out shares the delegation ceiling: children run at depth+1
    // with every delegation tool withheld, so fan-out can never recurse.
    const scatterSpawn: ScatterSpawn | undefined =
      subagentDepth >= maxDelegationDepth
        ? undefined
        : async (tasks: string[], maxSteps: number, mode: "spawn" | "fork", strategy: "concat" | "vote"): Promise<string> => {
            const inheritedBase: ChatMessage[] =
              mode === "fork" ? [...spec.history, { role: "user", content: spec.question }] : [];
            const results = new Array<{ answer: string; failure: string | null }>(tasks.length);
            let cursor = 0;
            const worker = async (): Promise<void> => {
              while (cursor < tasks.length) {
                const index = cursor;
                cursor += 1;
                const task = tasks[index] as string;
                // Abort parity with direct tools: a cancelled parent stops the
                // fan-out instead of joining a failure memo.
                if (spec.signal?.aborted) {
                  const aborted = new Error("Aborted");
                  aborted.name = "AbortError";
                  throw aborted;
                }
                results[index] = await runNested(
                  task,
                  maxSteps,
                  `/scatter-${index + 1}`,
                  [SUBAGENT_TOOL_NAME, RALPH_TOOL_NAME, SCATTER_TOOL_NAME],
                  mode === "fork" ? [...inheritedBase, { role: "user", content: `Scatter slice ${index + 1}/${tasks.length}` }] : [],
                );
              }
            };
            const workers = Array.from(
              { length: Math.min(SCATTER_MAX_CONCURRENCY, tasks.length) },
              () => worker(),
            );
            await Promise.all(workers);
            const settled = results.map((nested, index) =>
              nested.failure !== null ? `[task ${index + 1}/${tasks.length}: failed: ${nested.failure}]` : nested.answer,
            );
            if (strategy === "vote") {
              const { winner, counts } = majorityVote(settled);
              const tally = counts.map((count, index) => `task ${index + 1}: ${count} vote(s)`).join(", ");
              return `[scatter vote: task ${winner + 1} wins (${tally})]\n${settled[winner] as string}`;
            }
            return settled.map((answer, index) => `[task ${index + 1}/${tasks.length}]\n${answer}`).join("\n\n");
          };
    const skillPolicy = String((spec.config as Record<string, unknown>)["skill_policy"] ?? "on_demand");
    const mcpPolicy = String((spec.config as Record<string, unknown>)["mcp_policy"] ?? "off");
    const approvalMode = (spec.config as Record<string, unknown>)["approval_mode"];
    const sandboxMode = (spec.config as Record<string, unknown>)["sandbox_mode"];
    // Preloaded injects the effective catalog (bundled + user dir + workspace,
    // disabled filtered), not just the bundled set, so settings changes apply.
    const skillPreloadBlock =
      skillPolicy === "preloaded"
        ? renderBundledSkillsBlock(
            effectiveSkills(
              (filePath) => workspace.fs.readFile(filePath),
              (dir) => workspace.fs.listFiles(dir, { recursive: true }),
            ).skills,
          )
        : "";
    // Cross-session memory mounts top-level only: nested delegation turns share
    // files, never recalled context (their parent already carries the recall).
    // (memoryService/memoryPolicy/subagentDepth are hoisted above the try.)
    const memoryRecall =
      subagentDepth === 0 ? await recallMemoryForRun(memoryService, memoryPolicy, spec.question) : undefined;
    // Per-run context analytics: usage estimates + strategy observations are
  // reported at run end so operators see what each context strategy cost.
    const contextAnalytics = createContextAnalytics();
    const context: AgentExecutionContext = {
      identity: { agentId: spec.agentId, runId: spec.runId },
      config: spec.config,
      question: spec.question,
      // One render at the execution boundary: drivers and the fork/subagent
      // history below all see the mode's shape; minimal is byte-identical.
      history: renderHistoryForMode(spec.history, spec.config.history_mode ?? "minimal"),
      turn: spec.turn,
      workspace,
      tracker,
      clock: deps.clock,
      rag: ragCache,
      llm: spec.columnRuntime.llm,
      llmVendor: spec.columnRuntime.llmVendor,
      tools: buildToolAccess(workspace, spec.config.toolset, ragCache, spec.signal, spec.toolNames, subagentSpawn, ralphSpawn, scatterSpawn, mcpPolicy, skillPolicy, spec.sessions, String(approvalMode ?? "auto"), String(sandboxMode ?? "off"), subagentDepth === 0 || spec.propagateAskUser === true ? spec.askUser : undefined, spec.toolTuning),
      skillPreloadBlock,
      memoryRecall,
      contextAnalytics,
      contextTuning: spec.contextTuning,
      notices: spec.notices,
      systemPromptOverride: spec.systemPromptOverride,
      signal: spec.signal,
      get verificationFeedback() {
        return feedback.text;
      },
    };
    // External MCP servers attach top-level only (nested runs inherit files,
    // not server processes); explicit toolNames overrides stay authoritative;
    // read_only columns never gain remote tools (their mutation surface is
    // unknowable, so fail-closed beats operator trust here).
    if (
      subagentDepth === 0 &&
      (spec.mcpServers ?? []).length > 0 &&
      spec.toolNames === undefined &&
      spec.config.toolset !== "read_only"
    ) {
      remoteClients = await attachRemoteMcpServers(context.tools.registry, spec.mcpServers ?? [], spec.mcpTransport, {
        roots: [workspace.cwd()],
      });
    }
    // Invariant: buildToolAccess backs ToolAccess.names with the same mutable
    // Set the execute path authorizes against, so late-bridged remote names join
    // the identical authorization set (no second allowlist to drift).
    const authorized = context.tools.names as Set<string>;
    for (const definition of context.tools.registry.listDefinitions()) {
      authorized.add(definition.name);
    }

    let driverCompleted = false;
    // Ordered unique tool names observed this run (caps the episodic keyActions).
    const seenTools: string[] = [];
    // Answer mirror for the structured finalize; maintained with the same
    // preference rule as extractAnswerFromEvents (last thought with banner
    // skip, falling back to the last observation) so the finalize normalizes
    // exactly what downstream consumers would extract.
    let structuredAnswer = "";
    let streamingAnswer = "";
    let structuredLastObservation = "";
    // The driver's terminal complete is held back so the structured finalize
    // below can land before it: thread persistence extracts at the complete
    // event, so the normalized answer must precede it.
    let heldComplete: ArenaEvent | null = null;
    // Workload observed from the event stream for the synthesized complete events below.
    // Definitions match the drivers' own accounting one-to-one: every streamed LLM call
    // emits exactly one step_start (native stream-turn, langchain/langgraph onChatModelStart)
    // and exactly one action event per tool call (native tool-batch, langchain/langgraph
    // onToolStart) — the same action-counting the verification loop applies to judge attempts.
    // Invoke-based driver pre-passes that ride no events (plan-execute planner/replan,
    // self-critique critic) are deliberately not counted; the structured finalize below
    // emits its own step_start so it stays counted.
    for await (const event of runVerificationLoop(
      {
        level: spec.config.harness,
        question: spec.question,
        llm: spec.columnRuntime.llm,
        tracker,
        signal: spec.signal,
        feedback,
        pipelineLabel: label,
        workspaceName,
        maxRetries: spec.harnessMaxRetries,
      },
      () => spec.driver.run(context),
    )) {
      if (event.type === "step_start") observedSteps += 1;
      else if (event.type === "action") {
        observedToolCalls += 1;
        const toolName = typeof event.tool === "string" ? event.tool.trim() : "";
        if (toolName !== "" && !seenTools.includes(toolName) && seenTools.length < 12) seenTools.push(toolName);
      } else if (event.type === "complete") {
        driverCompleted = true;
        if (heldComplete === null) heldComplete = event;
        continue;
      }
      if (event.type === "thought") {
        if (!isPipelineConfigBanner(event.content)) structuredAnswer = event.content ?? "";
      } else if (event.type === "thought_delta") {
        const chunk = event.content ?? "";
        if (chunk !== "" && !(streamingAnswer === "" && isPipelineConfigBanner(chunk))) {
          streamingAnswer += chunk;
          structuredAnswer = streamingAnswer;
        }
      } else if (event.type === "thought_end") {
        structuredAnswer = (event.content ?? "") !== "" ? (event.content ?? "") : streamingAnswer;
        streamingAnswer = "";
      } else if (event.type === "observation") {
        structuredLastObservation = event.result ?? "";
      }
      yield stampEvent(event, label, spec.turn, spec.agentId, spec.runId, deps.clock.now());
    }

    // Structured profile: normalize the final answer through one schema-constrained
    // invoke so every downstream consumer reads the same canonical JSON. Fail-open:
    // finalize returns null on any failure and the raw answer stands. The finalize
    // is a real LLM call, so it emits the step_start/thought pair to keep the
    // one-step-start-per-LLM-call invariant the metrics rely on. It runs BEFORE
    // the held-back terminal complete: thread persistence extracts at the
    // complete event, so the normalized answer must precede it. Skipped for
    // failed runs — a failed complete is terminal, no further calls happen.
    if (structuredAnswer === "") structuredAnswer = structuredLastObservation;
    if (
      spec.config.prompt_profile === "structured" &&
      structuredAnswer !== "" &&
      heldComplete?.metrics?.success !== false &&
      spec.signal?.aborted !== true
    ) {
      const normalized = await finalizeStructuredAnswer(context, structuredAnswer);
      if (normalized !== null) {
        observedSteps += 1;
        const finalizeStep = observedSteps;
        yield stampEvent(
          {
            type: "step_start",
            pipeline: label,
            workspace: workspaceName,
            content: "",
            tool: "",
            args: {},
            result: "",
            step: finalizeStep,
            passed: null,
            reason: "",
            metrics: null,
            message: "",
            token_stats: null,
            turn: spec.turn,
            runId: spec.runId,
            timestamp: deps.clock.now(),
          },
          label,
          spec.turn,
          spec.agentId,
          spec.runId,
          deps.clock.now(),
        );
        yield stampEvent(
          {
            type: "thought",
            pipeline: label,
            workspace: workspaceName,
            content: `[Structured final answer]\n${normalized}`,
            tool: "",
            args: {},
            result: "",
            step: finalizeStep,
            passed: null,
            reason: "",
            metrics: null,
            message: "",
            token_stats: null,
            turn: spec.turn,
            runId: spec.runId,
            timestamp: deps.clock.now(),
          },
          label,
          spec.turn,
          spec.agentId,
          spec.runId,
          deps.clock.now(),
        );
        // The finalize turn is real work: fold it into the terminal metrics.
        if (heldComplete !== null && heldComplete.metrics !== null) {
          heldComplete = { ...heldComplete, metrics: { ...heldComplete.metrics, steps: finalizeStep } };
        }
      }
    }
    if (heldComplete !== null) {
      yield stampEvent(heldComplete, label, spec.turn, spec.agentId, spec.runId, deps.clock.now());
    }

    // Context analytics report: per-source composition estimates plus what the
    // budget/checkpoint strategies cut, when they ran. Operators read this in
    // runtime logs; the ledger itself stays per-run and in-memory.
    if (subagentDepth === 0) {
      const summary = summarizeAnalytics(contextAnalytics);
      if (!summary.usage.includes("no turns recorded")) console.info(`[agent] ${summary.usage.replaceAll("\n", " | ")}`);
      if (summary.effectiveness !== "") console.info(`[agent] ${summary.effectiveness.replaceAll("\n", " | ")}`);
    }

    // Episodic settlement: top-level runs distill one mini post-mortem per
    // execution (task, tools, outcome) so later sessions recall what worked.
    if (subagentDepth === 0) {
      await recordEpisodicExperience(memoryService, memoryPolicy, {
        task: spec.question.slice(0, 500),
        framework: spec.config.framework,
        model: spec.config.model_id,
        success: true,
        keyActions: seenTools,
        lessons: `Completed in ${observedSteps} steps with ${observedToolCalls} tool calls.`,
      });
    }

    if (!driverCompleted) {
      yield completeEvent({
        pipeline: label,
        workspace: workspaceName,
        metrics: buildMetrics(tracker, {
          success: true,
          durationMs: deps.clock.now() - started,
          toolCalls: observedToolCalls,
          steps: observedSteps,
        }),
        turn: spec.turn,
        runId: spec.runId,
        agentId: spec.agentId,
        timestamp: deps.clock.now(),
      });
    }
  } catch (error) {
    console.error(`[agent-execution] run failed (${spec.config.framework}/${spec.config.model_id}):`, error);
    const failureMessage = sanitizeErrorMessage(error);
    if (subagentDepth === 0) {
      await recordEpisodicExperience(memoryService, memoryPolicy, {
        task: spec.question.slice(0, 500),
        framework: spec.config.framework,
        model: spec.config.model_id,
        success: false,
        keyActions: [],
        lessons: `Failed after ${observedSteps} steps with ${observedToolCalls} tool calls: ${failureMessage.slice(0, 300)}`,
      });
    }
    yield arenaErrorEvent({
      pipeline: label,
      workspace: workspaceName,
      message: failureMessage,
      turn: spec.turn,
      runId: spec.runId,
      timestamp: deps.clock.now(),
      agentId: spec.agentId,
    });
    yield completeEvent({
      pipeline: label,
      workspace: workspaceName,
      // A failed run still reports the work done before the failure (observed above),
      // never zeroed placeholders: aggregates must see attempted steps and tool calls.
      metrics: buildMetrics(tracker, {
        success: false,
        durationMs: deps.clock.now() - started,
        toolCalls: observedToolCalls,
        steps: observedSteps,
      }),
      turn: spec.turn,
      runId: spec.runId,
      agentId: spec.agentId,
      timestamp: deps.clock.now(),
    });
  } finally {
    // Attached MCP servers own child processes: close them on every exit path
    // (complete, fail, abort) so runs cannot leak spawned servers. close() is
    // idempotent and rejects pending calls, so double-close is safe.
    for (const client of remoteClients) client.close();
    deps.workspaceRegistry.unprotect(workspaceName);
  }
}
