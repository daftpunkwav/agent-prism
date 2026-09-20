/**
 * @file message-text
 * @description Visible-text helpers for framework-neutral LlmMessage values.
 *
 * Responsibilities:
 * - Flatten heterogeneous content blocks to plain text
 * - Provide the shared char-proxy token estimate for budget arithmetic
 */

import type { LlmMessage } from "@agentprism/contracts";
import { CHARS_PER_TOKEN, estimateTokensFromChars, textFromContent } from "@agentprism/contracts";

// Compatibility re-exports: the canonical implementations live in contracts/llm-message
// (single source); new code imports { textFromContent, CHARS_PER_TOKEN } from "@agentprism/contracts".
export { textFromContent };
export { CHARS_PER_TOKEN };

/** Convenience accessor for LlmMessage content text. */
export function messageText(message: LlmMessage): string {
  return textFromContent(message.content);
}

/** Char-proxy token estimate for one message (never zero, so empty messages still count). */
export function estimateMessageTokens(message: LlmMessage, charsPerToken: number = CHARS_PER_TOKEN): number {
  return estimateTokensFromChars(messageText(message).length, charsPerToken);
}
