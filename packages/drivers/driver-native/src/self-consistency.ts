/**
 * @file self-consistency
 * @description Native self-consistency loop: N independent react attempts, then majority vote.
 *
 * Responsibilities:
 * - Run full react attempts with fresh message lists (independent sampling)
 * - Emit every attempt's events normally, then the shared vote outcome
 *
 * Each attempt gets the full max_steps budget (attempts are independent full
 * runs; total cost scales with N — the same semantics as the langgraph loop).
 * Fresh per-attempt message lists are the independence requirement — attempt N
 * never sees earlier attempts' transcripts.
 */

import type { ArenaEvent, ChatTurnMessage, LlmAssistantMessage, LlmMessage, ToolDefinition } from "@agentprism/contracts";
import { extractAnswerFromEvents } from "@agentprism/contracts";
import { buildInitialMessages, type AgentExecutionContext } from "@agentprism/harness";
import { selfConsistencyAttempts, selfConsistencyOutcomeEvents } from "@agentprism/driver-registry";
import { afterLlm, createReasoningState, isFinished } from "./reasoning-state.js";
import { collectPriorToolNames, executeToolCalls } from "./tool-batch.js";
import { streamLlmTurn } from "./stream-turn.js";

function isAssistantMessage(item: ArenaEvent | LlmAssistantMessage): item is LlmAssistantMessage {
  return "role" in item && item.role === "assistant";
}

function isToolMessage(
  item: ArenaEvent | { role: string },
): item is { role: "tool"; content: string; toolCallId: string; name?: string } {
  return "role" in item && item.role === "tool";
}

/**
 * Runs the self-consistency loop for one native column. The driver's complete
 * event and metrics tail stay with the caller; this generator covers the
 * attempts plus the vote outcome only.
 */
export async function* runSelfConsistencyLoop(args: {
  context: AgentExecutionContext;
  system: string;
  user: string;
  history?: ChatTurnMessage[];
  maxSteps: number;
  stats: { step: number; turns: number; toolCalls: number };
  retrieveSnippets: (query: string) => string;
  toolDefinitions: readonly ToolDefinition[];
}): AsyncGenerator<ArenaEvent> {
  const { context, system, user, history, maxSteps, stats, retrieveSnippets, toolDefinitions } = args;
  const attempts = selfConsistencyAttempts();
  const samples: string[] = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const turnsAtAttemptStart = stats.turns;
    const attemptState = createReasoningState("react");
    const messages: LlmMessage[] = buildInitialMessages(system, user, history);
    const attemptEvents: ArenaEvent[] = [];
    while (stats.turns - turnsAtAttemptStart < maxSteps && !isFinished(attemptState)) {
      let response: LlmAssistantMessage | null = null;
      for await (const item of streamLlmTurn(context, messages, attemptState, stats, retrieveSnippets, toolDefinitions)) {
        if (isAssistantMessage(item)) response = item;
        else {
          attemptEvents.push(item);
          yield item;
        }
      }
      if (response === null) break;
      // Prior names must exclude the current response: collect before pushing it
      // (same convention as the single-run loop in native-driver.ts).
      const priorToolNames = collectPriorToolNames(messages);
      messages.push(response);
      const hadTools = (response.toolCalls ?? []).length > 0;
      if (!hadTools) {
        afterLlm(attemptState, response, false);
        continue;
      }
      for await (const item of executeToolCalls(context, response, context.question, priorToolNames, stats)) {
        if (isToolMessage(item)) messages.push(item);
        else {
          attemptEvents.push(item);
          yield item;
        }
      }
      afterLlm(attemptState, response, true);
    }
    const extracted = extractAnswerFromEvents(attemptEvents).trim();
    if (extracted !== "") samples.push(extracted);
  }
  yield* selfConsistencyOutcomeEvents(samples, attempts, {
    label: context.config.label,
    workspace: context.workspace.name,
    step: stats.step,
  });
}
