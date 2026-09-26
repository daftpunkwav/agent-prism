/**
 * @file openai-agents-driver
 * @description OpenAI Agents SDK driver: the SDK's own run loop (handoffs,
 *              guardrails, tool dispatch) over the Arena model and tool ports.
 *
 * Responsibilities:
 * - Run the framework's Runner with an Arena-backed Model and function tools
 * - Keep step/turn accounting and stream text/thinking onto ArenaEvents
 * - Map the SDK's run-item stream onto action/observation events
 *
 * The SDK owns the agent loop; the model is an implementation of its public
 * Model interface over LlmAdapter, so provider configuration, wire capture and
 * the token ledger stay shared with every other column. Verification retries are
 * owned by runVerificationLoop outside drivers.
 */

import type { ArenaEvent, AgentDriver } from "@agentprism/contracts";
import {
  PIPELINE_BANNER_PREFIX,
  OBSERVATION_MAX_CHARS,
  arenaErrorEvent,
  sanitizeErrorMessage,
  tokenUpdateEvent,
} from "@agentprism/contracts";
import {
  buildInitialMessages,
  buildSystemUser,
  recordAdapterUsage,
  type AgentExecutionContext,
} from "@agentprism/harness";
import {
  createRunState,
  emitToolOutcomeEvents,
  eventOf,
  finishEvent,
  formatCapabilityPluginIds,
  normalizeActionArgs,
  stepBudgetFor,
  type RunState,
} from "@agentprism/driver-run-support";
import { Agent, run } from "@openai/agents";
import { ArenaModel } from "./arena-model.js";
import { fromLlmMessages } from "./input-bridge.js";
import { bindRegistryToolsForAgents } from "./tool-bridge.js";

/** Loosely-typed view of the SDK's run items (shape verified against the SDK's own models). */
interface ItemLike {
  rawItem?: { name?: unknown; arguments?: unknown } | undefined;
  output?: unknown;
}

/** Text of a tool output item, which the SDK types as `string | unknown`. */
function outputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (output === null || output === undefined) return "";
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

/** OpenAI Agents SDK Driver: Runner + Arena-backed Model/function tools. */
export class OpenAIAgentsDriver implements AgentDriver {
  readonly frameworkId = "openai_agents";
  readonly displayName = "OpenAI Agents SDK";

  async *run(context: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
    const { config, question, history, tools, tracker } = context;
    const label = config.label;
    const state = createRunState(label, tracker, context.clock);
    state.workspaceName = context.workspace.name;

    const { system, user } = buildSystemUser(context);
    tracker.seedPrompt(system, user);
    yield tokenUpdateEvent({ pipeline: label, token_stats: tracker.asDict(), workspace: state.workspaceName });

    const historyCount = history.length;
    yield eventOf({
      type: "thought",
      pipeline: label,
      workspace: state.workspaceName,
      step: 0,
      content:
        `${PIPELINE_BANNER_PREFIX.openai_agents} Runner · ` +
        `reasoning=${config.reasoning} · prompt=${config.prompt_profile} · ` +
        `context=${config.context} · harness=${config.harness} · ` +
        `temp=${config.temperature} · model=${config.model_id} · ` +
        `max_steps=${config.max_steps} · toolset=${config.toolset} · ` +
        `mcp=${String((config as Record<string, unknown>)["mcp_policy"] ?? "off")} · ` +
        `skill=${String((config as Record<string, unknown>)["skill_policy"] ?? "on_demand")} · ` +
        `orchestration=${String((config as Record<string, unknown>)["orchestration"] ?? "direct")} · ` +
        `history_mode=${String((config as Record<string, unknown>)["history_mode"] ?? "minimal")}` +
        (historyCount > 0 ? ` · history=${historyCount}` : "") +
        ` · ${formatCapabilityPluginIds(config)}`,
      turn: context.turn,
      timestamp: context.clock.now(),
      agentId: context.identity.agentId,
    });

    const extra: ArenaEvent[] = [];
    try {
      const definitions = tools.registry.listDefinitions();
      const byName = new Map(definitions.map((definition) => [definition.name, definition]));
      const model = new ArenaModel(
        context.llm,
        (name) => byName.get(name),
        {
        onRequestStart: () => {
          state.step += 1;
          state.turns += 1;
          state.streamingStep = state.step;
          extra.push(
            eventOf({ type: "step_start", pipeline: label, step: state.step, content: "", workspace: state.workspaceName }),
          );
        },
        onRequestEnd: () => {
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
          }
        },
        onTextDelta: (text) => {
          const step = state.streamingStep ?? state.step;
          extra.push(
            eventOf({ type: "thought_delta", pipeline: label, step, content: text, workspace: state.workspaceName }),
          );
        },
        onReasoning: (text) => {
          const step = state.streamingStep ?? state.step;
          extra.push(
            eventOf({ type: "thinking", pipeline: label, step, content: text, workspace: state.workspaceName }),
          );
        },
        onUsage: (usage) => recordAdapterUsage(usage, tracker),
      });

      const agent = new Agent({
        name: agentName(label),
        instructions: system,
        model,
        tools: bindRegistryToolsForAgents(tools, {
          question,
          harness: config.harness,
          signal: context.signal,
          onOutcome: (name, outcome) => {
            state.toolCalls += 1;
            extra.push(...emitToolOutcomeEvents(label, state.workspaceName, state.step, name, outcome));
          },
        }),
      });

      const turnBudget = stepBudgetFor(config.max_steps);
      // Built field-by-field: a conditional spread widens `stream` and loses the
      // overload that returns a StreamedRunResult.
      const runOptions: { stream: true; maxTurns?: number; signal?: AbortSignal } = { stream: true };
      // Unlimited budgets omit the cap entirely (Infinity is not a usable bound).
      if (Number.isFinite(turnBudget)) runOptions.maxTurns = turnBudget;
      if (context.signal !== undefined) runOptions.signal = context.signal;
      const stream = await run(agent, fromLlmMessages(buildInitialMessages(system, user, history)), runOptions);

      for await (const event of stream) {
        for (const queued of extra.splice(0)) yield queued;
        for (const mapped of this.translateRunEvent(state, event)) yield mapped;
      }
      for (const queued of extra.splice(0)) yield queued;

      yield finishEvent(state, true);
    } catch (error) {
      // Server-side detail log; the client-facing event stays sanitized.
      console.error(`[openai-agents-driver] column "${label}" failed:`, error);
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

  /**
   * Maps one SDK run event onto ArenaEvents: tool calls become actions, tool
   * outputs observations. Text and thinking leave through the model hooks, so
   * raw model stream events need no translation here (they are the same deltas).
   */
  private translateRunEvent(state: RunState, event: unknown): ArenaEvent[] {
    if (event === null || typeof event !== "object") return [];
    const record = event as { type?: unknown; name?: unknown; item?: unknown };
    if (record.type !== "run_item_stream_event") return [];
    const item = (record.item ?? {}) as ItemLike;
    if (record.name === "tool_called") {
      const name = typeof item.rawItem?.name === "string" ? item.rawItem.name : "";
      if (name === "") return [];
      state.step += 1;
      return [
        eventOf({
          type: "action",
          pipeline: state.label,
          step: state.step,
          tool: name,
          args: normalizeActionArgs(name, parseToolArgs(item.rawItem?.arguments)),
          workspace: state.workspaceName,
        }),
      ];
    }
    if (record.name === "tool_output") {
      state.step += 1;
      return [
        eventOf({
          type: "observation",
          pipeline: state.label,
          step: state.step,
          result: outputText(item.output).slice(0, OBSERVATION_MAX_CHARS),
          workspace: state.workspaceName,
        }),
      ];
    }
    return [];
  }
}

/** Parses a function call's JSON argument string into an args object. */
function parseToolArgs(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { input: parsed };
  } catch {
    return { input: raw };
  }
}

/** SDK agent names are identifiers: column labels may carry spaces or punctuation. */
function agentName(label: string): string {
  const cleaned = label.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^_+|_+$/g, "");
  return cleaned === "" ? "agent" : cleaned;
}
