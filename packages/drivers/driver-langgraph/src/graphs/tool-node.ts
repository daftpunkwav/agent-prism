/**
 * @file graphs/tool-node
 * @description Executes tool calls for LangGraph reasoning graphs.
 *
 * Responsibilities:
 * - Run pending tool calls and append results to graph state
 */

import { AIMessage, ToolMessage } from "@langchain/core/messages";
import {
  blockedToolMessageContent,
  extractOriginalQuestion,
  injectToolResultReminder,
} from "@agentprism/harness";
import { sanitizeErrorMessage } from "@agentprism/contracts";
import { fromLcMessages } from "@agentprism/driver-langchain";
import { canonicalToolName } from "@agentprism/driver-run-support";
import type { AgentStateType, ReasoningGraphDeps } from "./state.js";

interface ToolCallLike {
  name?: string;
  args?: unknown;
  id?: string;
}

/** Executes tool calls; unknown tools also produce a ToolMessage to stay 1:1 with tool_calls. */
export async function reactToolNode(state: AgentStateType, deps: ReasoningGraphDeps): Promise<Partial<AgentStateType>> {
  const messages = state.messages ?? [];
  const lastMessage = messages[messages.length - 1];
  const toolCalls = ((lastMessage as AIMessage | undefined)?.tool_calls ?? []) as ToolCallLike[];

  const question = extractOriginalQuestion(fromLcMessages(state.messages ?? []));
  const priorNames: string[] = [];
  for (const message of messages) {
    const calls = (message as AIMessage).tool_calls;
    if (Array.isArray(calls) && message !== lastMessage) {
      for (const toolCall of calls) priorNames.push(String(toolCall.name ?? ""));
    }
  }

  const toolMessages: ToolMessage[] = [];
  let toolCallCount = state.tool_calls ?? 0;
  for (const rawCall of toolCalls) {
    const toolName = canonicalToolName(deps.tools.names, String(rawCall.name ?? ""));
    const call = { ...rawCall, name: toolName };
    const toolArgs = (call.args && typeof call.args === "object" ? call.args : {}) as Record<string, unknown>;
    const blocked = blockedToolMessageContent(question, toolName, toolArgs, priorNames, deps.harness);
    if (blocked !== null) {
      toolMessages.push(new ToolMessage({ content: blocked, tool_call_id: String(call.id ?? "") }));
      continue;
    }
    if (!deps.tools.names.has(toolName)) {
      toolMessages.push(
        new ToolMessage({
          content: injectToolResultReminder(`Error: unknown tool «${toolName}»`, question),
          tool_call_id: String(call.id ?? ""),
        }),
      );
      continue;
    }
    // Signal tool start before executing so the driver can emit the action row
    // immediately: interactive tools (ask_user) wait on the human and the graph
    // stream stays silent meanwhile, so an after-only row would leave the column
    // with no UI until completion (the LangGraph "stuck" run).
    deps.onToolStart?.(toolName, toolArgs);
    // Always go through tools.execute so RAG invalidation and hooks stay shared with Native/LC.
    let outcome: Awaited<ReturnType<typeof deps.tools.execute>>;
    try {
      outcome = await deps.tools.execute(toolName, toolArgs, { signal: deps.signal });
    } catch (error) {
      // Tool runtime exceptions become error text and the loop continues, matching the native driver (except cancellation signals)
      if ((error as Error)?.name === "AbortError") throw error;
      outcome = {
        result: `Error: tool ${toolName} failed: ${sanitizeErrorMessage(error)}`,
        fileDiff: null,
        ok: false,
        code: "workspace_error",
      };
    }
    deps.onToolExecuted?.(toolName, toolArgs, outcome);
    const result = outcome.result;
    toolCallCount += 1;
    priorNames.push(toolName);
    toolMessages.push(
      new ToolMessage({
        content: injectToolResultReminder(String(result), question),
        tool_call_id: String(call.id ?? ""),
      }),
    );
  }
  return { messages: toolMessages, tool_calls: toolCallCount };
}
