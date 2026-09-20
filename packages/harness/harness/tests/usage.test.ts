/**
 * @file usage tests
 * @description Locks single-source vendor usage recording.
 *
 * Responsibilities:
 * - Pin the full shape matrix (input_tokens/prompt_tokens dual naming)
 */

import { describe, expect, it } from "vitest";
import { TokenTracker } from "@agentprism/telemetry";
import { extractLlmUsage, recordAdapterUsage } from "../src/usage.js";

function freshTracker(): TokenTracker {
  return new TokenTracker({ contextWindow: 128000, maxInputTokens: 120000, maxOutputTokens: 2048 });
}

describe("recordAdapterUsage", () => {
  it("records OpenAI-style token_usage payloads (the namings the old per-file copies missed)", () => {
    const tracker = freshTracker();
    recordAdapterUsage({ prompt_tokens: 10, completion_tokens: 5 }, tracker);
    expect(tracker.asDict().input_tokens).toBe(10);
    expect(tracker.asDict().output_tokens).toBe(5);
  });

  it("ignores missing or zero usage (totals stay zero)", () => {
    const tracker = freshTracker();
    recordAdapterUsage(undefined, tracker);
    recordAdapterUsage({ input_tokens: 0, output_tokens: 0 }, tracker);
    expect(tracker.asDict().input_tokens).toBe(0);
    expect(tracker.asDict().output_tokens).toBe(0);
  });

  it("extractLlmUsage reads nested vendor shapes", () => {
    expect(extractLlmUsage({ output: { usage_metadata: { input_tokens: 3, output_tokens: 4 } } })).toEqual({
      inputTokens: 3,
      outputTokens: 4,
    });
    expect(extractLlmUsage({ nope: true })).toBeNull();
  });
});
