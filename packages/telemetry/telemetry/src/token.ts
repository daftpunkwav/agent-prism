/**
 * @file token
 * @description Per-run token accounting with context-window usage ratios.
 *
 * Responsibilities:
 * - Prefer API-reported usage, fall back to character-based estimation
 * - Track context-window consumption ratios
 */

import type { TokenStats } from "@agentprism/contracts";

/** Rough token estimate: about 3 characters per token; empty strings count as 0. */
function estimateTokens(text: string): number {
  if (text === "") return 0;
  return Math.max(1, Math.floor(text.length / 3));
}

/** Token accountant for one column run: API usage takes priority, estimates otherwise. */
export class TokenTracker {
  readonly contextWindow: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  private inputTokens = 0;
  private outputTokens = 0;
  private estimatedInputTokens = 0;
  private inputFromApi = false;
  private outputFromApi = false;

  constructor(config: { contextWindow?: number; maxInputTokens?: number; maxOutputTokens?: number } = {}) {
    this.contextWindow = config.contextWindow ?? 128_000;
    this.maxInputTokens = config.maxInputTokens ?? 120_000;
    this.maxOutputTokens = config.maxOutputTokens ?? 96000;
  }

  /** Seeds the estimate baseline with the initial prompt's size. */
  seedPrompt(system: string, user: string): void {
    this.estimatedInputTokens = estimateTokens(system) + estimateTokens(user);
  }

  addUsage(usage: { inputTokens: number; outputTokens: number }): void {
    // Choke point for all producers (extraction, judges): provider-reported usage is
    // untrusted input, so non-finite or negative values are ignored instead of poisoning totals.
    if (Number.isFinite(usage.inputTokens) && usage.inputTokens > 0) {
      this.inputTokens += usage.inputTokens;
      // Per-direction flags: an all-zero or one-sided report must not flip the other
      // direction away from its seed estimate (providers that never report usage would
      // otherwise collapse a parent column's input tokens to 0 after one nested call).
      this.inputFromApi = true;
    }
    if (Number.isFinite(usage.outputTokens) && usage.outputTokens > 0) {
      this.outputTokens += usage.outputTokens;
      this.outputFromApi = true;
    }
  }

  get effectiveInputTokens(): number {
    return this.inputFromApi ? this.inputTokens : this.estimatedInputTokens;
  }

  get totalTokens(): number {
    return this.effectiveInputTokens + this.outputTokens;
  }

  get contextUsagePct(): number {
    return roundPct(Math.min(100, (this.totalTokens / this.contextWindow) * 100));
  }

  get inputUsagePct(): number {
    return roundPct(Math.min(100, (this.effectiveInputTokens / this.maxInputTokens) * 100));
  }

  asDict(): TokenStats {
    return {
      // Effective, not raw: with no provider usage the input side is the seed estimate,
      // and reporting raw 0 here contradicted the non-zero total beside it.
      input_tokens: this.effectiveInputTokens,
      output_tokens: this.outputTokens,
      total_tokens: this.totalTokens,
      context_window: this.contextWindow,
      max_input_tokens: this.maxInputTokens,
      max_output_tokens: this.maxOutputTokens,
      context_usage_pct: this.contextUsagePct,
      input_usage_pct: this.inputUsagePct,
    };
  }
}

function roundPct(value: number): number {
  return Math.round(value * 100) / 100;
}
