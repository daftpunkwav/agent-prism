/**
 * @file token accounting tests
 * @description Covers TokenTracker's provider-usage / estimate accounting invariants.
 *
 * Responsibilities:
 * - Pin per-direction API preference over the prompt estimate
 * - Pin that non-finite/negative provider usage is ignored, never poisoning totals
 * - Pin ratio reporting: clamped to 0-100 and rounded to two decimals
 */

import { describe, expect, it } from "vitest";
import { TokenTracker } from "../src/token.js";

describe("TokenTracker estimate fallback", () => {
  it("reports the seeded prompt estimate while no provider usage arrives", () => {
    const tracker = new TokenTracker({ contextWindow: 1_000, maxInputTokens: 100 });
    // 9 and 3 chars at the 3-chars-per-token estimate: 3 + 1 input tokens.
    tracker.seedPrompt("abcdefghi", "jkl");
    const stats = tracker.asDict();
    expect(stats.input_tokens).toBe(4);
    expect(stats.output_tokens).toBe(0);
    expect(stats.total_tokens).toBe(4);
    expect(stats.input_usage_pct).toBe(4);
  });

  it("counts empty prompt halves as zero", () => {
    const tracker = new TokenTracker();
    tracker.seedPrompt("", "");
    expect(tracker.asDict().input_tokens).toBe(0);
  });
});

describe("TokenTracker provider usage", () => {
  it("prefers API-reported usage over the estimate and sums repeated calls", () => {
    const tracker = new TokenTracker();
    tracker.seedPrompt("x".repeat(300), "");
    tracker.addUsage({ inputTokens: 120, outputTokens: 7 });
    tracker.addUsage({ inputTokens: 80, outputTokens: 3 });
    const stats = tracker.asDict();
    expect(stats.input_tokens).toBe(200);
    expect(stats.output_tokens).toBe(10);
    expect(stats.total_tokens).toBe(210);
  });

  it("keeps each direction independent: a one-sided report must not zero the other estimate", () => {
    const tracker = new TokenTracker();
    tracker.seedPrompt("x".repeat(30), "");
    // Output-only report (providers that never report input usage).
    tracker.addUsage({ inputTokens: 0, outputTokens: 50 });
    const stats = tracker.asDict();
    expect(stats.input_tokens).toBe(10);
    expect(stats.output_tokens).toBe(50);
    expect(stats.total_tokens).toBe(60);
  });

  it("ignores non-finite and negative usage instead of poisoning the totals", () => {
    const tracker = new TokenTracker({ contextWindow: 100 });
    tracker.seedPrompt("x".repeat(30), "");
    tracker.addUsage({ inputTokens: Number.NaN, outputTokens: -5 });
    tracker.addUsage({ inputTokens: Number.POSITIVE_INFINITY, outputTokens: Number.NaN });
    const stats = tracker.asDict();
    expect(stats.input_tokens).toBe(10);
    expect(stats.output_tokens).toBe(0);
    expect(stats.total_tokens).toBe(10);

    // Valid usage afterwards still lands plus the untouched estimate.
    tracker.addUsage({ inputTokens: 4, outputTokens: 1 });
    expect(tracker.asDict()).toMatchObject({ input_tokens: 4, output_tokens: 1, total_tokens: 5 });
  });
});

describe("TokenTracker ratios", () => {
  it("clamps both percentages to 100 and rounds to two decimals", () => {
    const tracker = new TokenTracker({ contextWindow: 100, maxInputTokens: 10 });
    tracker.addUsage({ inputTokens: 500, outputTokens: 500 });
    const stats = tracker.asDict();
    expect(stats.context_usage_pct).toBe(100);
    expect(stats.input_usage_pct).toBe(100);
  });

  it("rounds fractional percentages to two decimals", () => {
    const tracker = new TokenTracker({ contextWindow: 1_000, maxInputTokens: 7 });
    tracker.addUsage({ inputTokens: 1, outputTokens: 0 });
    const stats = tracker.asDict();
    expect(stats.context_usage_pct).toBe(0.1);
    expect(stats.input_usage_pct).toBe(14.29);
  });

  it("exposes the configured window and output cap for the stats panel", () => {
    const tracker = new TokenTracker({ contextWindow: 2_000, maxInputTokens: 1_500, maxOutputTokens: 512 });
    const stats = tracker.asDict();
    expect(stats.context_window).toBe(2_000);
    expect(stats.max_input_tokens).toBe(1_500);
    expect(stats.max_output_tokens).toBe(512);
  });
});
