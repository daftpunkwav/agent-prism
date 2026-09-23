/**
 * @file langgraph-driver
 * @description LangGraph-backed driver with real reasoning-mode graph structures.
 *
 * Responsibilities:
 * - Build and stream the graph for the selected reasoning mode
 * - Translate live events through the shared translation layer
 *
 * Verification retries are owned by runVerificationLoop outside drivers.
 */

import { OBSERVATION_MAX_CHARS, arenaErrorEvent, PIPELINE_BANNER_PREFIX, sanitizeErrorMessage, tokenUpdateEvent } from "@agentprism/contracts";
import type { ArenaEvent, AgentDriver, ToolExecutionResult } from "@agentprism/contracts";
import {
  createColumnSnippetRetriever,
  getReasoningDescription,
  buildInitialMessages,
  buildSystemUser,
  type AgentExecutionContext,
} from "@agentprism/harness";
import { createRunState, emitStreamEvent, emitToolOutcomeEvents, eventOf, finishEvent, recursionLimitFor, formatCapabilityPluginIds, normalizeActionArgs, selfConsistencyAttempts } from "@agentprism/driver-registry";
import { bindRegistryTools, requireChatModel, toLcMessages } from "@agentprism/driver-langchain";
import { buildReasoningGraph } from "./reasoning-graphs.js";
import { runSelfConsistencyLoop } from "./self-consistency.js";

/** Skeleton nodes excluded from on_node_start phase hints (agent/execute/tools are the main loop nodes). */
const NODE_START_EXCLUDED = new Set(["agent", "execute", "tools"]);

/** Drains one compiled graph's streamEvents into ArenaEvents, racing short ticks so tool-side extras surface during interactive waits. */
async function* drainGraphStream(
  stream: AsyncIterator<unknown>,
  state: ReturnType<typeof createRunState>,
  extra: ArenaEvent[],
  aborted: () => boolean,
): AsyncGenerator<ArenaEvent> {
  let streamDone = false;
  let pending: Promise<IteratorResult<unknown, unknown>> | null = null;
  const tick = () => new Promise<null>((resolve) => setTimeout(() => resolve(null), 100));
  while (!streamDone) {
    pending ??= stream.next();
    const next = await Promise.race([pending, tick()]);
    for (const queued of extra.splice(0)) yield queued;
    if (next === null) {
      if (aborted()) throw new DOMException("Aborted", "AbortError");
      continue;
    }
    pending = null;
    if (next.done === true) {
      streamDone = true;
      continue;
    }
    const raw = next.value;
    const rawNodeName =
      raw !== null && typeof raw === "object" ? String((raw as Record<string, unknown>).name ?? "") : "";
    for (const event of emitStreamEvent(state, raw, {
      nodeName: rawNodeName,
      nodeStartExcluded: NODE_START_EXCLUDED,
    })) {
      yield event;
    }
  }
  for (const queued of extra.splice(0)) yield queued;
}

/** LangGraph Driver: real reasoning-mode graph structures + live streamed output. */
export class LangGraphDriver implements AgentDriver {
  readonly frameworkId = "langgraph";
  readonly displayName = "LangGraph";

  async *run(context: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
    const { config, history, tools, tracker } = context;
    const model = requireChatModel(context.llmVendor);
    const label = config.label;
    const state = createRunState(label, tracker, context.clock);
    state.workspaceName = context.workspace.name;

    const { system, user } = buildSystemUser(context);
    tracker.seedPrompt(system, user);
    yield tokenUpdateEvent({ pipeline: label, token_stats: tracker.asDict(), workspace: state.workspaceName });

    const modeLabel = getReasoningDescription(config.reasoning) || "ReAct loop";
    const historyCount = history.length;
    yield eventOf({
      type: "thought",
      pipeline: label,
      workspace: state.workspaceName,
      step: 0,
      content:
        `${PIPELINE_BANNER_PREFIX.langgraph} ${modeLabel} · reasoning=${config.reasoning} · prompt=${config.prompt_profile} · ` +
        `context=${config.context}(real trim) · harness=${config.harness} · ` +
        `temp=${config.temperature} · model=${config.model_id} · ` +
        `max_steps=${config.max_steps} · toolset=${config.toolset} · ` +
        `mcp=${String((config as Record<string, unknown>)["mcp_policy"] ?? "off")} · ` +
        `skill=${String((config as Record<string, unknown>)["skill_policy"] ?? "on_demand")} · ` +
        `orchestration=${String((config as Record<string, unknown>)["orchestration"] ?? "direct")}` +
        ` · history_mode=${String((config as Record<string, unknown>)["history_mode"] ?? "minimal")}` +
        (historyCount > 0 ? ` · history=${historyCount}` : "") +
        ` · ${formatCapabilityPluginIds(config)}`,
      turn: context.turn,
      timestamp: context.clock.now(),
      agentId: context.identity.agentId,
    });

    try {
      const extra: ArenaEvent[] = [];
      const closeStreamingThought = () => {
        if (state.streamingStep !== null) {
          extra.push(
            eventOf({
              type: "thought_end",
              pipeline: label,
              step: state.streamingStep,
              content: "",
              workspace: state.workspaceName,
            }),
          );
          state.streamingStep = null;
          state.thinkingStep = null;
        }
      };
      // Fires synchronously before each tool executes (see tool-node): the action row
      // must reach the column while an interactive tool waits on the human, not after
      // it completes. The graph stream stays silent during the wait, so without this
      // split the run shows no UI until the 5-min timeout (the LangGraph "stuck" run).
      const handleToolStart = (name: string, args: Record<string, unknown>) => {
        closeStreamingThought();
        state.toolCalls += 1;
        state.step += 1;
        extra.push(
          eventOf({
            type: "action",
            pipeline: label,
            step: state.step,
            tool: name,
            args: normalizeActionArgs(name, args),
            workspace: state.workspaceName,
          }),
        );
      };
      const recordTool = (name: string, _args: Record<string, unknown>, outcome: ToolExecutionResult) => {
        closeStreamingThought();
        extra.push(...emitToolOutcomeEvents(label, state.workspaceName, state.step, name, outcome));
        state.step += 1;
        extra.push(
          eventOf({
            type: "observation",
            pipeline: label,
            step: state.step,
            result: outcome.result.slice(0, OBSERVATION_MAX_CHARS),
            workspace: state.workspaceName,
          }),
        );
      };
      const lcTools = bindRegistryTools(tools, { signal: context.signal });
      const deps = {
        model,
        tools,
        lcTools,
        retrieveSnippets: createColumnSnippetRetriever(context.rag, context.workspace),
        contextTuning: context.contextTuning,
        harness: config.harness,
        signal: context.signal,
        onToolExecuted: recordTool,
        onToolStart: handleToolStart,
      };
      const aborted = () => context.signal?.aborted === true;
      const freshInitialState = () => ({
        messages: toLcMessages(buildInitialMessages(system, user, history)),
        step_count: 0,
        max_steps: Math.trunc(config.max_steps),
        tool_calls: 0,
        reflections: [] as string[],
        context_strategy: config.context,
      });

      if (config.reasoning === "self_consistency") {
        // Self-consistency bypasses the per-mode graph dispatch: N independent
        // react attempts, each with a fresh initial state (independent sampling),
        // then the shared majority vote. max_steps applies per attempt.
        const compiled = buildReasoningGraph("react", deps).withConfig({
          recursionLimit: recursionLimitFor(config.max_steps),
          signal: context.signal,
        });
        yield* runSelfConsistencyLoop({
          attempts: selfConsistencyAttempts(),
          attemptStream: () =>
            drainGraphStream(
              compiled.streamEvents(freshInitialState(), { version: "v2" })[Symbol.asyncIterator](),
              state,
              extra,
              aborted,
            ),
          fields: { label, workspace: state.workspaceName, step: () => state.step },
        });
        yield finishEvent(state, true);
        return;
      }

      const graph = buildReasoningGraph(config.reasoning, deps).withConfig({
        recursionLimit: recursionLimitFor(config.max_steps),
        signal: context.signal,
      });
      const initialState = freshInitialState();

      // The graph stream stays silent while a tool node awaits the human (ask_user);
      // drainGraphStream races the single pending pull against short ticks so early
      // actions (handleToolStart) reach the column while waiting instead of after
      // completion. One shared pending pull: re-racing new next() calls per tick
      // would pile up queued pulls on the same iterator during a long wait.
      yield* drainGraphStream(
        graph.streamEvents(initialState, { version: "v2" })[Symbol.asyncIterator](),
        state,
        extra,
        aborted,
      );

      yield finishEvent(state, true);
    } catch (error) {
      yield arenaErrorEvent({
        pipeline: label,
        workspace: state.workspaceName,
        message: sanitizeErrorMessage(error),
        turn: context.turn,
        timestamp: context.clock.now(),
        agentId: context.identity.agentId,
      });
      yield finishEvent(state, false);
    }
  }
}
