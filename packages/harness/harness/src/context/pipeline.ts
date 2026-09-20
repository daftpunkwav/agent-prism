/**
 * @file pipeline
 * @description Shared pre-model message pipeline over LlmMessage[].
 *
 * Responsibilities:
 * - Apply strategy trim, then sanitize, then tool grounding
 * - Record per-source usage and strategy observations when analytics is wired
 * - Append the wrap-up reminder when a context budget is configured
 *
 * All drivers must use this entry so Arena columns stay comparable; no vendor
 * Chat SDK types here.
 */

import type { LlmMessage } from "@agentprism/contracts";
import { isStrategyName, observeStrategy, recordPreparedUsage, type ContextAnalytics } from "./analytics.js";
import { prepareMessagesForLlm, type AssembleOptions } from "./messages.js";
import { maybeAppendContextReminder } from "./remaining.js";
import { sanitizeMessagesForModel } from "./sanitize.js";
import { withToolGrounding } from "./anchoring.js";
import { UnknownPromptConfigError } from "../prompt/errors.js";

const KNOWN_STRATEGIES = new Set(["sliding", "summary", "vector", "hybrid", "tool_tail", "token_budget", "budget", "checkpoint"]);

export interface ContextPipelineOptions extends AssembleOptions {
  /** When true (default), apply sanitize + tool grounding after trim. */
  sanitizeAndGround?: boolean;
  /** Per-run analytics seam: records per-source usage and strategy observations. */
  analytics?: ContextAnalytics;
  /** Operator-supplied model context budget (estimated tokens); set to enable the wrap-up reminder. */
  contextBudgetTokens?: number;
  /** Reminder threshold ratio override (default 0.85 of the budget). */
  contextReminderThreshold?: number;
}

/**
 * Applies the column context strategy then (by default) sanitize + grounding.
 * When a context budget is configured, a wrap-up reminder is appended once
 * estimated usage crosses the threshold. Unknown strategies fail closed.
 */
export function applyContextPipeline(
  messages: LlmMessage[],
  strategy: string,
  options: ContextPipelineOptions = {},
): LlmMessage[] {
  if (!KNOWN_STRATEGIES.has(strategy)) {
    throw new UnknownPromptConfigError("context", strategy);
  }
  const trimmed = prepareMessagesForLlm(messages, strategy, options);
  if (options.analytics !== undefined) {
    recordPreparedUsage(options.analytics, trimmed);
    // Every strategy is observed, not just the lossy budget ones: kept/dropped
    // volume grounds ablation rows. Ledger detection covers each applier's
    // marker ([Context summary] / [Budget ledger] / [Context checkpoint]).
    const ledgerEmitted = trimmed.some(
      (m) =>
        m.role === "system" &&
        (m.content.includes("[Budget ledger]") ||
          m.content.includes("[Context summary]") ||
          m.content.includes("[Context checkpoint]")),
    );
    if (isStrategyName(strategy)) {
      observeStrategy(options.analytics, strategy, messages, trimmed, ledgerEmitted);
    }
  }
  const grounded = options.sanitizeAndGround === false
    ? trimmed
    : withToolGrounding(sanitizeMessagesForModel(trimmed));
  if (options.contextBudgetTokens === undefined) {
    return grounded;
  }
  return maybeAppendContextReminder(grounded, {
    budgetTokens: options.contextBudgetTokens,
    thresholdRatio: options.contextReminderThreshold,
    charsPerToken: options.charsPerToken,
  }).messages;
}
