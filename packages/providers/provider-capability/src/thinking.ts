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
  /** anthropic_messages: thinking block config. */
  thinking?: { type: "enabled"; budget_tokens: number };
  /** max_tokens automatically raised when the budget is too large. */
  maxTokens?: number;
  /** openai_chat / openai_responses: reasoning-effort level. */
  reasoningEffort?: string;
}

/**
 * Builds thinking parameters per API format.
 * Returns null for thinking-incapable models, off, or unmapped levels (no
 * thinking params attached). OpenAI-compatible formats pass the level string
 * through verbatim so vendor-defined档位 (xhigh/max/…) reach the API as-is.
 */
export function buildThinkingClientOptions(
  apiFormat: ApiFormat | string,
  level: string,
  thinkingCapable: boolean,
  maxTokens: number,
): ThinkingClientOptions | null {
  if (!thinkingCapable || level === "off") return null;

  if (apiFormat === "anthropic_messages") {
    const budget = THINKING_BUDGET[level as ThinkingLevel];
    if (budget === undefined || budget <= 0) return null;
    const options: ThinkingClientOptions = {
      thinking: { type: "enabled", budget_tokens: budget },
    };
    if (maxTokens < budget + 1024) {
      options.maxTokens = budget + 1024;
    }
    return options;
  }
  if (apiFormat === "openai_chat" || apiFormat === "openai_responses") {
    return { reasoningEffort: level };
  }
  // Unknown formats keep the legacy conservative mapping.
  const effort = level === "low" || level === "medium" || level === "high" ? level : "medium";
  return { reasoningEffort: effort };
}
