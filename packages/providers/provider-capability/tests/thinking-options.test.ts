/**
 * @file thinking options tests
 * @description Locks per-protocol thinking params: budgets, gates, token floor.
 */

import { describe, expect, it } from "vitest";
import { buildThinkingClientOptions, THINKING_BUDGET } from "../src/thinking.js";

describe("buildThinkingClientOptions", () => {
  it("returns null for incapable models and off levels", () => {
    expect(buildThinkingClientOptions("anthropic_messages", "high", false, 32000)).toBeNull();
    expect(buildThinkingClientOptions("anthropic_messages", "off", true, 32000)).toBeNull();
    expect(buildThinkingClientOptions("anthropic_messages", "ultra", true, 32000)).toBeNull();
  });

  it("builds anthropic thinking blocks with the level budget", () => {
    const options = buildThinkingClientOptions("anthropic_messages", "high", true, 64000);
    expect(options?.thinking).toEqual({ type: "enabled", budget_tokens: THINKING_BUDGET.high });
    expect(options?.maxTokens).toBeUndefined();
  });

  it("raises maxTokens when the budget would not fit", () => {
    const options = buildThinkingClientOptions("anthropic_messages", "high", true, 1000);
    expect(options?.maxTokens).toBe((THINKING_BUDGET.high ?? 0) + 1024);
  });

  it("maps openai levels to reasoning effort", () => {
    expect(buildThinkingClientOptions("openai_chat", "low", true, 4096)?.reasoningEffort).toBe("low");
    expect(buildThinkingClientOptions("openai_chat", "high", true, 4096)?.reasoningEffort).toBe("high");
    expect(buildThinkingClientOptions("openai_responses", "medium", true, 4096)?.reasoningEffort).toBe("medium");
  });

  it("passes vendor-defined levels through verbatim on openai formats", () => {
    expect(buildThinkingClientOptions("openai_chat", "xhigh", true, 4096)?.reasoningEffort).toBe("xhigh");
    expect(buildThinkingClientOptions("openai_responses", "max", true, 4096)?.reasoningEffort).toBe("max");
  });

  it("returns null for levels without a budget", () => {
    expect(buildThinkingClientOptions("anthropic_messages", "bogus", true, 4096)).toBeNull();
    expect(buildThinkingClientOptions("mystery_format", "bogus", true, 4096)?.reasoningEffort).toBe("medium");
  });
});
