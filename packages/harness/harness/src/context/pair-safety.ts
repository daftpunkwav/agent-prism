/**
 * @file pair-safety
 * @description Assistant/tool pair integrity for lossy context strategies.
 *
 * Responsibilities:
 * - Drop tool results whose requesting assistant turn was cut
 * - Strip unanswerable tool calls from kept assistant turns
 *
 * Providers reject both orphan shapes outright (OpenAI: "assistant message with
 * 'tool_calls' must be followed by tool messages"; Anthropic: orphan tool_result),
 * so a strategy that sheds messages per-source or per-priority can turn an
 * over-budget transcript into a hard 400 instead of a lossy-but-valid one. The
 * pass is order-preserving and non-mutating; system/user turns pass through.
 */

import type { LlmMessage } from "@agentprism/contracts";

/**
 * Rewrites one kept message list so every surviving tool result has a kept
 * requester and every surviving tool call has its kept result. Assistant turns
 * whose calls were only partially answered keep just the answerable subset
 * (each surviving call is answered, which is what the wire format requires).
 * An assistant left with no calls and no text (a fully shed tool-call shell)
 * is dropped outright: Anthropic rejects empty assistant content mid-list, so
 * keeping the shell would still turn the trimmed transcript into a hard 400.
 */
export function stripUnpairedToolTurns(messages: LlmMessage[]): LlmMessage[] {
  const requested = new Set<string>();
  const answered = new Set<string>();
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const call of message.toolCalls ?? []) requested.add(call.id);
    } else if (message.role === "tool") {
      answered.add(message.toolCallId);
    }
  }
  return messages.map((message) => {
    if (message.role === "assistant") {
      const calls = message.toolCalls;
      if (calls === undefined) return message;
      const answerable = calls.filter((call) => answered.has(call.id));
      if (answerable.length === calls.length) return message;
      if (answerable.length === 0) {
        // Fully shed shell: keep it only when it still says something; an empty
        // assistant body is a wire error on Anthropic even without tool calls.
        if (message.content.trim() === "") return null;
        return { ...message, toolCalls: undefined };
      }
      return { ...message, toolCalls: answerable };
    }
    if (message.role === "tool" && !requested.has(message.toolCallId)) return null;
    return message;
  }).filter((message): message is LlmMessage => message !== null);
}
