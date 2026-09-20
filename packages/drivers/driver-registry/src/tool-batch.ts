/**
 * @file tool-batch
 * @description Shared driver tool-batch executor for neutral-transcript backends.
 *
 * Responsibilities:
 * - Collect prior tool names for context
 * - Run tool calls sequentially in request order, emitting action/observation events
 * - Append LlmToolMessage results for the caller's message list
 *
 * LangChain-free; used by the native driver and the autogen/crewai backends.
 */

import type { ArenaEvent, LlmAssistantMessage, LlmMessage, LlmToolMessage } from "@agentprism/contracts";
import { OBSERVATION_MAX_CHARS, sanitizeErrorMessage } from "@agentprism/contracts";
import { blockedToolMessageContent, type AgentExecutionContext } from "@agentprism/harness";
import { eventOf, emitToolOutcomeEvents, normalizeActionArgs, canonicalToolName } from "./event-translation.js";

/** Collects tool names already used in the message history (excluding the current response). */
export function collectPriorToolNames(messages: LlmMessage[]): string[] {
  const names: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant" || message.toolCalls === undefined) continue;
    for (const call of message.toolCalls) names.push(call.name);
  }
  return names;
}

/** Executes a batch of toolCalls: emits Arena events and yields LlmToolMessages. */
export async function* executeToolCalls(
  context: AgentExecutionContext,
  response: LlmAssistantMessage,
  question: string,
  priorToolNames: string[],
  stats: { step: number; turns: number; toolCalls: number },
): AsyncGenerator<ArenaEvent | LlmToolMessage> {
  const { config, workspace, tools } = context;
  const label = config.label;
  const workspaceName = workspace.name;

  for (const call of response.toolCalls ?? []) {
    const name = canonicalToolName(tools.names, call.name);
    const args = call.args;
    if (!tools.names.has(name)) {
      yield {
        role: "tool",
        content: `Error: tool ${name} is not authorized`,
        toolCallId: call.id,
        name,
      };
      continue;
    }
    const blocked = blockedToolMessageContent(question, name, args, priorToolNames, context.config.harness);
    if (blocked !== null) {
      yield { role: "tool", content: blocked, toolCallId: call.id, name };
      continue;
    }
    stats.toolCalls += 1;
    stats.step += 1;
    yield eventOf({ type: "action", pipeline: label, step: stats.step, tool: name, args: normalizeActionArgs(name, args), workspace: workspaceName });

    let execution;
    try {
      execution = await tools.execute(name, args, { signal: context.signal });
    } catch (error) {
      if ((error as Error)?.name === "AbortError") throw error;
      execution = {
        result: `Error: tool ${name} failed: ${sanitizeErrorMessage(error)}`,
        fileDiff: null,
        ok: false,
        code: "workspace_error",
      };
    }
    const { result, fileDiff } = execution;
    for (const event of emitToolOutcomeEvents(label, workspaceName, stats.step, name, { result, fileDiff })) {
      yield event;
    }
    stats.step += 1;
    yield eventOf({
      type: "observation",
      pipeline: label,
      step: stats.step,
      result: result.slice(0, OBSERVATION_MAX_CHARS),
      workspace: workspaceName,
    });

    yield { role: "tool", content: result, toolCallId: call.id, name };
  }
}
