/**
 * @file llm-message-bridge
 * @description Bidirectional contracts LlmMessage and LangChain BaseMessage conversion.
 *
 * Responsibilities:
 * - Convert neutral transcripts to and from LC messages
 *
 * Used only inside the LangChain-family drivers (LangChain, LangGraph,
 * Deep Agents) so the harness stays free of vendor types.
 */

import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { LlmMessage } from "@agentprism/contracts";
import { normalizeToolCalls, textFromContent } from "@agentprism/contracts";

/** LlmMessage[] → LangChain BaseMessage[]. */
export function toLcMessages(messages: LlmMessage[]): BaseMessage[] {
  return messages.map((message) => {
    if (message.role === "system") return new SystemMessage(message.content);
    if (message.role === "user") return new HumanMessage(message.content);
    if (message.role === "tool") {
      return new ToolMessage({
        content: message.content,
        tool_call_id: message.toolCallId,
        name: message.name,
      });
    }
    return new AIMessage({
      content: message.content,
      tool_calls: (message.toolCalls ?? []).map((call) => ({
        id: call.id,
        name: call.name,
        args: call.args,
        type: "tool_call" as const,
      })),
    });
  });
}

/** LangChain BaseMessage[] → LlmMessage[]. */
export function fromLcMessages(messages: BaseMessage[]): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const message of messages) {
    const type = message.getType();
    if (type === "system") {
      out.push({ role: "system", content: textFromContent(message.content) });
      continue;
    }
    if (type === "human") {
      out.push({ role: "user", content: textFromContent(message.content) });
      continue;
    }
    if (type === "tool") {
      const toolMessage = message as ToolMessage;
      out.push({
        role: "tool",
        content: textFromContent(toolMessage.content),
        toolCallId: String(toolMessage.tool_call_id ?? ""),
        name: toolMessage.name,
      });
      continue;
    }
    if (type === "ai") {
      const ai = message as AIMessage;
      const toolCalls = normalizeToolCalls(ai.tool_calls);
      out.push({
        role: "assistant",
        content: textFromContent(ai.content),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      });
      continue;
    }
    // Unknown vendor types: degrade to user text so the pipeline never drops content silently.
    out.push({ role: "user", content: textFromContent(message.content) });
  }
  return out;
}
