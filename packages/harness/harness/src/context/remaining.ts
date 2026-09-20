/**
 * @file context/remaining
 * @description Context-budget reminder appended after the message pipeline.
 *
 * Responsibilities:
 * - Estimate the prepared message list in shared char-proxy tokens
 * - Append one wrap-up system reminder when usage crosses the budget threshold
 *
 * The pipeline is a pure per-call function, so the reminder never accumulates
 * across turns: it exists only in the current request payload, never written
 * back into history. Without a configured budget the reminder is skipped and
 * behavior is unchanged; the budget is operator-supplied because no portable
 * window metadata exists across providers.
 */

import type { LlmMessage } from "@agentprism/contracts";
import { estimateMessageTokens } from "./message-text.js";

/** Usage ratio at or above which the wrap-up reminder fires. */
export const CONTEXT_REMINDER_THRESHOLD_RATIO = 0.85;

export interface ContextReminderOptions {
  /** Operator-supplied model context budget in estimated tokens. */
  budgetTokens: number;
  /** Fires at budgetTokens * ratio (default 0.85). */
  thresholdRatio?: number;
  /** Char-proxy divisor for the usage estimate (default 4). */
  charsPerToken?: number;
}

/** Estimated token total over the whole prepared message list. */
export function estimateContextTokens(messages: readonly LlmMessage[], charsPerToken?: number): number {
  let total = 0;
  for (const message of messages) total += estimateMessageTokens(message, charsPerToken);
  return total;
}

/**
 * Appends the wrap-up reminder when usage crosses the threshold. Pure: the
 * input is never mutated; the reminder is a new trailing system message.
 */
export function maybeAppendContextReminder(
  messages: readonly LlmMessage[],
  options: ContextReminderOptions,
): { messages: LlmMessage[]; reminderEmitted: boolean } {
  const ratio = options.thresholdRatio ?? CONTEXT_REMINDER_THRESHOLD_RATIO;
  if (!Number.isFinite(options.budgetTokens) || options.budgetTokens <= 0) {
    return { messages: [...messages], reminderEmitted: false };
  }
  const used = estimateContextTokens(messages, options.charsPerToken);
  if (used < Math.floor(options.budgetTokens * ratio)) {
    return { messages: [...messages], reminderEmitted: false };
  }
  const pct = Math.min(100, Math.round((used / options.budgetTokens) * 100));
  const reminder: LlmMessage = {
    role: "system",
    content:
      `[Context budget] about ${used} of ${options.budgetTokens} estimated tokens used (${pct}%). ` +
      "Wrap up: finish the current step, avoid opening new large reads, then deliver the answer.",
  };
  return { messages: [...messages, reminder], reminderEmitted: true };
}
