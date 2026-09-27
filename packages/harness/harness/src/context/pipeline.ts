/**
 * @file pipeline
 * @description Shared pre-model message pipeline over LlmMessage[].
 *
 * Responsibilities:
 * - Apply strategy trim, then active custom-dimension message hooks, then pair
 *   safety, sanitize, and tool grounding
 * - Record per-source usage and strategy observations when analytics is wired
 * - Append the wrap-up reminder when a context budget is configured
 *
 * All drivers must use this entry so Arena columns stay comparable; no vendor
 * Chat SDK types here.
 */

import type { LlmMessage } from "@agentprism/contracts";
import { isBuiltinContextStrategy } from "@agentprism/contracts";
import { observeStrategy, recordPreparedUsage, type ContextAnalytics } from "./analytics.js";
import { prepareMessagesForLlm, type AssembleOptions } from "./messages.js";
import { maybeAppendContextReminder } from "./remaining.js";
import { stripUnpairedToolTurns } from "./pair-safety.js";
import { sanitizeMessagesForModel } from "./sanitize.js";
import { withToolGrounding } from "./anchoring.js";
import { UnknownPromptConfigError } from "../prompt/errors.js";
import type { ActiveCustomDimension } from "../dimensions/custom-dimensions.js";
import { applyCustomMessages, type CustomDimensionRun } from "../dimensions/custom-dimension-hooks.js";

export interface ContextPipelineOptions extends AssembleOptions {
  /** When true (default), apply sanitize + tool grounding after trim. */
  sanitizeAndGround?: boolean;
  /** Per-run analytics seam: records per-source usage and strategy observations. */
  analytics?: ContextAnalytics;
  /** Operator-supplied model context budget (estimated tokens); set to enable the wrap-up reminder. */
  contextBudgetTokens?: number;
  /** Reminder threshold ratio override (default 0.85 of the budget). */
  contextReminderThreshold?: number;
  /**
   * Active custom dimensions of this run, injected by the run assembly. Their
   * `messages` hooks run after the context strategy and before the tail below.
   */
  customDimensions?: readonly ActiveCustomDimension[];
  /** Run facts custom-dimension hooks may consult (question + configured values). */
  customRun?: CustomDimensionRun;
}

/**
 * Shared post-transform tail: pair safety + sanitize + tool grounding plus the
 * optional budget reminder. Every strategy and every custom-dimension hook runs
 * through the same tail, so all columns stay comparable and provider-valid.
 */
export function finishContextPipeline(trimmed: LlmMessage[], options: ContextPipelineOptions = {}): LlmMessage[] {
  const paired = stripUnpairedToolTurns(trimmed);
  const grounded = options.sanitizeAndGround === false
    ? paired
    : withToolGrounding(sanitizeMessagesForModel(paired));
  if (options.contextBudgetTokens === undefined) {
    return grounded;
  }
  return maybeAppendContextReminder(grounded, {
    budgetTokens: options.contextBudgetTokens,
    thresholdRatio: options.contextReminderThreshold,
    charsPerToken: options.charsPerToken,
  }).messages;
}

/**
 * Applies the column context strategy, then the active custom-dimension message
 * hooks, then (by default) pair safety + sanitize + grounding. When a context
 * budget is configured, a wrap-up reminder is appended once estimated usage
 * crosses the threshold. Anything that is neither a builtin strategy nor — via
 * `options.customDimensions` — an active custom dimension, fails closed.
 */
export function applyContextPipeline(
  messages: LlmMessage[],
  strategy: string,
  options: ContextPipelineOptions = {},
): LlmMessage[] {
  if (!isBuiltinContextStrategy(strategy)) {
    throw new UnknownPromptConfigError("context", strategy);
  }
  const trimmed = prepareMessagesForLlm(messages, strategy, options);
  const activeDimensions = options.customDimensions ?? [];
  const analytics = options.analytics;
  let shaped: readonly LlmMessage[] = trimmed;
  if (activeDimensions.length > 0) {
    shaped = applyCustomMessages(
      activeDimensions,
      trimmed,
      options.customRun ?? { question: "", custom: {} },
      // Per-dimension rows: each measures that dimension's own hook, not the fold.
      analytics === undefined
        ? undefined
        : (dimensionId, before, after) => observeStrategy(analytics, dimensionId, before, after, false),
    );
  }
  if (analytics !== undefined) {
    recordPreparedUsage(analytics, shaped);
    // Every strategy is observed, not just the lossy budget ones: kept/dropped
    // volume grounds ablation rows. Ledger detection covers each applier's
    // marker ([Context summary] / [Budget ledger] / [Context checkpoint]).
    const ledgerEmitted = shaped.some(
      (m) =>
        m.role === "system" &&
        (m.content.includes("[Budget ledger]") ||
          m.content.includes("[Context summary]") ||
          m.content.includes("[Context checkpoint]")),
    );
    observeStrategy(analytics, strategy, messages, shaped, ledgerEmitted);
  }
  return finishContextPipeline([...shaped], options);
}
