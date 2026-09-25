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

  it("passes numeric anthropic levels through verbatim as budget_tokens", () => {
    const options = buildThinkingClientOptions("anthropic_messages", "32768", true, 64000);
    expect(options?.thinking).toEqual({ type: "enabled", budget_tokens: 32768 });
    expect(options?.maxTokens).toBeUndefined();
    // Below the 1024 protocol floor a numeric level fails closed.
    expect(buildThinkingClientOptions("anthropic_messages", "1023", true, 32000)).toBeNull();
    expect(buildThinkingClientOptions("anthropic_messages", "0", true, 32000)).toBeNull();
  });

  it("rides vendor thinking modes through verbatim on anthropic", () => {
    expect(buildThinkingClientOptions("anthropic_messages", "adaptive", true, 32000)?.thinking).toEqual({
      type: "adaptive",
    });
    expect(buildThinkingClientOptions("anthropic_messages", "ultra", true, 32000)?.thinking).toEqual({
      type: "ultra",
    });
  });

  it("lets a configured budget pair outrank the level mapping on anthropic", () => {
    const options = buildThinkingClientOptions(
      "anthropic_messages",
      "high",
      true,
      64000,
      { budgetTokens: 32768, maxTokens: 64000 },
    );
    expect(options?.thinking).toEqual({ type: "enabled", budget_tokens: 32768 });
    expect(options?.maxTokens).toBe(64000);
    // Without a usable paired cap the auto-raise still applies.
    const autoRaised = buildThinkingClientOptions(
      "anthropic_messages",
      "low",
      true,
      1000,
      { budgetTokens: 8192, maxTokens: 0 },
    );
    expect(autoRaised?.thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
    expect(autoRaised?.maxTokens).toBe(8192 + 1024);
    // Below-floor budgets are ignored and the level mapping applies instead.
    const ignored = buildThinkingClientOptions("anthropic_messages", "high", true, 64000, {
      budgetTokens: 512,
      maxTokens: 64000,
    });
    expect(ignored?.thinking).toEqual({ type: "enabled", budget_tokens: THINKING_BUDGET.high });
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

  it("returns null for levels without a budget on unmapped formats", () => {
    expect(buildThinkingClientOptions("mystery_format", "bogus", true, 4096)?.reasoningEffort).toBe("medium");
  });
});
