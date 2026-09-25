/**
 * @file stream-turn
 * @description Streams one LLM turn for the native agent.
 *
 * Responsibilities:
 * - Stream a single model turn using only LlmAdapter + LlmMessage
 *
 * No BaseChatModel / llmVendor here.
 */

import type { ArenaEvent, LlmAssistantMessage, LlmMessage, ToolDefinition } from "@agentprism/contracts";
import { applyContextPipeline, type AgentExecutionContext } from "@agentprism/harness";
import { eventOf } from "@agentprism/driver-run-support";
import {
  phaseHint,
  shouldBindTools,
  type ReasoningState,
} from "./reasoning-state.js";

/**
 * Streams one LLM turn: emits step_start, then thinking/thought_delta/thought_end,
 * then yields the completed assistant LlmMessage (with optional toolCalls).
 */
export async function* streamLlmTurn(
  context: AgentExecutionContext,
  messages: LlmMessage[],
  reasoning: ReasoningState,
  stats: { step: number; turns: number; toolCalls: number },
  retrieveSnippets: (query: string) => string,
  toolDefinitions: readonly ToolDefinition[],
): AsyncGenerator<ArenaEvent | LlmAssistantMessage> {
  const { config, workspace, llm } = context;
  const label = config.label;
  const workspaceName = workspace.name;

  const prepared = applyContextPipeline(messages, config.context, { retrieveSnippets, analytics: context.contextAnalytics, ...context.contextTuning });
  const extra = phaseHint(reasoning);
  if (extra.length > 0) prepared.push(...extra);

  const tools = toolDefinitions.length > 0 && shouldBindTools(reasoning) ? toolDefinitions : undefined;

  stats.step += 1;
  stats.turns += 1;
  const streamStep = stats.step;
  let text = "";
  const toolCalls: NonNullable<LlmAssistantMessage["toolCalls"]> = [];

  // Announce the call before the first token: a buffering provider can stay silent
  // for the whole turn, and this event is the column's only real-time signal
  yield eventOf({
    type: "step_start",
    pipeline: label,
    step: streamStep,
    content: "",
    workspace: workspaceName,
  });

  for await (const part of llm.stream(prepared, { tools, signal: context.signal })) {
    if (part.thinking !== undefined && part.thinking !== "") {
      yield eventOf({
        type: "thinking",
        pipeline: label,
        step: streamStep,
        content: part.thinking,
        workspace: workspaceName,
      });
    }
    if (part.text !== undefined && part.text !== "") {
      text += part.text;
      yield eventOf({
        type: "thought_delta",
        pipeline: label,
        step: streamStep,
        content: part.text,
        workspace: workspaceName,
      });
    }
    if (part.toolCalls !== undefined && part.toolCalls.length > 0) {
      toolCalls.push(...part.toolCalls);
    }
  }

  yield eventOf({
    type: "thought_end",
    pipeline: label,
    step: streamStep,
    content: "",
    workspace: workspaceName,
  });

  yield {
    role: "assistant",
    content: text,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}
