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
  /** openai_chat: reasoning-effort level. */
  reasoningEffort?: string;
}

/**
 * Builds thinking parameters per API format.
 * Returns null for thinking-incapable models or off/invalid levels (no thinking params attached).
 */
export function buildThinkingClientOptions(
  apiFormat: ApiFormat | string,
  level: string,
  thinkingCapable: boolean,
  maxTokens: number,
): ThinkingClientOptions | null {
  if (!thinkingCapable || level === "off") return null;
  const budget = THINKING_BUDGET[level as ThinkingLevel];
  if (budget === undefined || budget <= 0) return null;

  if (apiFormat === "anthropic_messages") {
    const options: ThinkingClientOptions = {
      thinking: { type: "enabled", budget_tokens: budget },
    };
    if (maxTokens < budget + 1024) {
      options.maxTokens = budget + 1024;
    }
    return options;
  }
  // openai_chat: map the reasoning-effort level only
  const effort = level === "low" || level === "medium" || level === "high" ? level : "medium";
  return { reasoningEffort: effort };
}
