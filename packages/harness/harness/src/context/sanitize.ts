/**
 * @file sanitize
 * @description Message sanitization before model calls.
 *
 * Responsibilities:
 * - Clean assistant history into a provider-compatible shape
 * - Flatten system messages for providers that require a single system role
 */

import type { LlmAssistantMessage, LlmMessage } from "@agentprism/contracts";
import { textFromContent } from "./message-text.js";

/**
 * Sanitizes a history assistant message: keeps visible text and toolCalls.
 *
 * Deliberately no synthetic placeholder for textless tool calls: a previous
 * `(called tools: …)` filler leaked into model-visible history, models imitated
 * it verbatim, and runs degenerated into echo loops (or "completed" with the
 * filler as the final answer). Empty text plus toolCalls is the canonical
 * LangChain tool-call shape and needs no filler.
 */
export function sanitizeAssistantMessage(message: LlmAssistantMessage): LlmAssistantMessage {
  const text = textFromContent(message.content);
  const toolCalls = message.toolCalls ?? [];
  return {
    role: "assistant",
    content: text,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

/**
 * Merges prefix system messages and converts non-prefix system messages into user
 * messages ([System supplement]). Anthropic Messages API forbids scattered system turns.
 */
export function flattenSystemMessagesForProvider(messages: LlmMessage[]): LlmMessage[] {
  const out: LlmMessage[] = [];
  let inPrefix = true;
  for (const message of messages) {
    if (inPrefix && message.role === "system") {
      const text = textFromContent(message.content);
      const previous = out[out.length - 1];
      if (previous !== undefined && previous.role === "system") {
        const prevText = textFromContent(previous.content);
        out[out.length - 1] = {
          role: "system",
          content: prevText !== "" ? `${prevText}\n\n${text}` : text,
        };
      } else {
        out.push({ role: "system", content: text });
      }
      continue;
    }
    inPrefix = false;
    if (message.role === "system") {
      const text = textFromContent(message.content).trim();
      if (text !== "") {
        out.push({ role: "user", content: `[System supplement]\n${text}` });
      }
      continue;
    }
    out.push(message);
  }
  return out;
}

/** Sanitizes messages about to enter the LLM (never mutates the originals). */
export function sanitizeMessagesForModel(messages: LlmMessage[]): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const message of messages) {
    if (message.role === "assistant") {
      out.push(sanitizeAssistantMessage(message));
    } else {
      out.push(message);
    }
  }
  return flattenSystemMessagesForProvider(out);
}
