/**
 * @file thinking
 * @description Per-protocol thinking parameter mapping.
 *
 * Responsibilities:
 * - Map thinking levels to anthropic thinking blocks or openai reasoning effort
 * - Apply token budgets per level
 */

import type { ApiFormat, ThinkingLevel } from "@agentprism/contracts";

/** Level → thinking token budget. */
export const THINKING_BUDGET: Record<ThinkingLevel, number> = {
  off: 0,
  low: 2048,
  medium: 8192,
  high: 16384,
};

export interface ThinkingClientOptions {
  /**
   * anthropic_messages: thinking block config. type is "enabled" for budgeted
   * levels; vendor modes ("adaptive", …) pass through verbatim.
   */
  thinking?: { type: string; budget_tokens?: number };
  /** max_tokens automatically raised when the budget is too large. */
  maxTokens?: number;
  /** openai_chat / openai_responses: reasoning-effort level. */
  reasoningEffort?: string;
}

/** Structured budget override: both values are token counts, maxTokens must exceed budgetTokens. */
export interface ThinkingBudgetOverride {
  budgetTokens: number;
  maxTokens: number;
}

/**
 * Builds thinking parameters per API format.
 * Returns null for thinking-incapable models, off, or unmapped levels (no
 * thinking params attached). OpenAI-compatible formats pass the level string
 * through verbatim so vendor-defined levels (xhigh/max/…) reach the API as-is.
 * A configured budget override (anthropic) outranks the level mapping.
 */
export function buildThinkingClientOptions(
  apiFormat: ApiFormat | string,
  level: string,
  thinkingCapable: boolean,
  maxTokens: number,
  budgetOverride?: ThinkingBudgetOverride,
): ThinkingClientOptions | null {
  if (!thinkingCapable || level === "off") return null;

  if (apiFormat === "anthropic_messages") {
    // A configured budget pair outranks the level: budget_tokens verbatim and
    // the paired output cap (it already passed the > budget check at parse).
    if (budgetOverride !== undefined && budgetOverride.budgetTokens >= 1024) {
      const options = anthropicBudgetOptions(budgetOverride.budgetTokens, maxTokens);
      if (budgetOverride.maxTokens > budgetOverride.budgetTokens) {
        options.maxTokens = budgetOverride.maxTokens;
      }
      return options;
    }
    // The messages API family expresses intensity two ways: a token budget —
    // numeric levels pass through verbatim as budget_tokens (protocol floor
    // 1024) and named levels use the fixed comparison table — or vendor
    // thinking modes ("adaptive", …) that ride the type field verbatim; the
    // upstream provider validates those, not this layer.
    const trimmed = level.trim();
    if (/^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed);
      // Numeric levels are budgets, full stop: below the protocol floor they
      // fail closed instead of masquerading as a vendor type.
      return numeric >= 1024 ? anthropicBudgetOptions(numeric, maxTokens) : null;
    }
    const tableBudget = THINKING_BUDGET[trimmed as ThinkingLevel];
    if (tableBudget !== undefined && tableBudget > 0) return anthropicBudgetOptions(tableBudget, maxTokens);
    return trimmed === "" ? null : { thinking: { type: trimmed } };
  }
  if (apiFormat === "openai_chat" || apiFormat === "openai_responses") {
    return { reasoningEffort: level };
  }
  // Unknown formats keep the legacy conservative mapping.
  const effort = level === "low" || level === "medium" || level === "high" ? level : "medium";
  return { reasoningEffort: effort };
}

/** Budgeted thinking block plus the max_tokens raise the budget < max_tokens rule forces. */
function anthropicBudgetOptions(budget: number, maxTokens: number): ThinkingClientOptions {
  const options: ThinkingClientOptions = {
    thinking: { type: "enabled", budget_tokens: budget },
  };
  if (maxTokens < budget + 1024) {
    options.maxTokens = budget + 1024;
  }
  return options;
}
