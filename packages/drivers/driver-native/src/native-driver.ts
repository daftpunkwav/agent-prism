/**
 * @file native-driver
 * @description In-house agent loop: call model, run tools, repeat.
 *
 * Responsibilities:
 * - Drive the native main loop over context.llm (LlmAdapter) and LlmMessage[]
 * - Gate tool binding per reasoning phase via the reasoning state machine
 *
 * No LangChain types in this driver.
 */

import type { AgentDriver, ArenaEvent, LlmAssistantMessage, LlmMessage } from "@agentprism/contracts";
import {
  PIPELINE_BANNER_PREFIX,
  completeEvent,
  tokenUpdateEvent,
} from "@agentprism/contracts";
import { buildMetrics } from "@agentprism/telemetry";
import {
  buildInitialMessages,
  buildSystemUser,
  createColumnSnippetRetriever,
  type AgentExecutionContext,
} from "@agentprism/harness";
import { afterLlm, createReasoningState, isFinished } from "./reasoning-state.js";
import { runSelfConsistencyLoop } from "./self-consistency.js";
import { eventOf, formatCapabilityPluginIds, totWidth } from "@agentprism/driver-registry";
import { executeToolCalls, collectPriorToolNames } from "./tool-batch.js";
import { streamLlmTurn } from "./stream-turn.js";

function isAssistantMessage(item: ArenaEvent | LlmAssistantMessage): item is LlmAssistantMessage {
  return "role" in item && item.role === "assistant";
}

function isToolMessage(
  item: ArenaEvent | { role: string },
): item is { role: "tool"; content: string; toolCallId: string; name?: string } {
  return "role" in item && item.role === "tool";
}

/** Native Driver: in-house agent main loop on LlmAdapter. */
export class NativeDriver implements AgentDriver {
  readonly frameworkId = "native";
  readonly displayName = "Native Agent";

  async *run(context: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
    const { config, question, history, tracker, workspace } = context;
    const label = config.label;
    const workspaceName = workspace.name;
    const started = context.clock.now();
    const reasoning = createReasoningState(config.reasoning, { totWidth: totWidth() });
    const stats = { step: 0, turns: 0, toolCalls: 0 };
    const retrieveSnippets = createColumnSnippetRetriever(context.rag, workspace);
    const toolDefinitions = context.tools.registry.listDefinitions();

    const { system, user } = buildSystemUser(context);
    tracker.seedPrompt(system, user);
    yield tokenUpdateEvent({ pipeline: label, token_stats: tracker.asDict(), workspace: workspaceName });
    yield eventOf({
      type: "thought",
      pipeline: label,
      step: 0,
      content:
        `${PIPELINE_BANNER_PREFIX.native} reasoning=${config.reasoning} · prompt=${config.prompt_profile} · ` +
        `context=${config.context} · harness=${config.harness} · toolset=${config.toolset} · ` +
        `mcp=${String((config as Record<string, unknown>)["mcp_policy"] ?? "off")} · ` +
        `skill=${String((config as Record<string, unknown>)["skill_policy"] ?? "on_demand")} · ` +
        `orchestration=${String((config as Record<string, unknown>)["orchestration"] ?? "direct")} · ` +
        formatCapabilityPluginIds(config),
      workspace: workspaceName,
    });

    const messages: LlmMessage[] = buildInitialMessages(system, user, history);
    // Clamp defensively: NaN max_steps would otherwise skip the loop and report success with zero work.
    // max_steps < 0 means "no step budget": the contract sentinel is -1, but any
    // negative value is treated the same (persisted configs may arrive
    // unvalidated), so the loop runs until the model stops calling tools, the
    // run is aborted, or a call times out.
    const maxSteps = Number.isFinite(config.max_steps)
      ? config.max_steps < 0
        ? Number.POSITIVE_INFINITY
        : Math.max(1, Math.trunc(config.max_steps))
      : 1;

    if (config.reasoning === "self_consistency") {
      // N independent react attempts (fresh message lists) then a majority vote;
      // the complete/metrics tail below is shared with the single-run path.
      yield* runSelfConsistencyLoop({
        context,
        system,
        user,
        history,
        maxSteps,
        stats,
        retrieveSnippets,
        toolDefinitions,
      });
    } else {
      while (stats.turns < maxSteps && !isFinished(reasoning)) {
        let response: LlmAssistantMessage | null = null;
        for await (const item of streamLlmTurn(
          context,
          messages,
          reasoning,
          stats,
          retrieveSnippets,
          toolDefinitions,
        )) {
          if (isAssistantMessage(item)) {
            response = item;
          } else {
            yield item;
          }
        }
        if (response === null) break;

        const priorToolNames = collectPriorToolNames(messages);
        messages.push(response);
        const hadTools = (response.toolCalls ?? []).length > 0;

        if (!hadTools) {
          afterLlm(reasoning, response, false);
          continue;
        }
        for await (const item of executeToolCalls(context, response, question, priorToolNames, stats)) {
          if (isToolMessage(item)) {
            messages.push(item);
          } else {
            yield item;
          }
        }
        afterLlm(reasoning, response, true);
      }
    }

    yield completeEvent({
      pipeline: label,
      workspace: workspaceName,
      metrics: buildMetrics(tracker, {
        success: true,
        durationMs: context.clock.now() - started,
        toolCalls: stats.toolCalls,
        steps: stats.turns,
      }),
      token_stats: tracker.asDict(),
      turn: context.turn,
      runId: context.identity.runId,
      agentId: context.identity.agentId,
      timestamp: context.clock.now(),
    });
  }
}
