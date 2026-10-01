/**
 * @file thinking level tests
 * @description Locks effective thinking-level resolution: capability gate and level allowlist.
 */

import { describe, expect, it } from "vitest";
import { effectiveThinkingLevel, servableThinkingLevels, thinkingBudgetApplicable } from "@agentprism/contracts";

describe("servableThinkingLevels", () => {
  it("serves nothing for a non-thinking endpoint", () => {
    expect(servableThinkingLevels({ thinking_capable: false, thinking_levels: ["low"] })).toEqual([]);
  });

  it("serves the custom list when configured, else the standard set", () => {
    expect(servableThinkingLevels({ thinking_capable: true, thinking_levels: ["xhigh", "max"] })).toEqual(["xhigh", "max"]);
    expect(servableThinkingLevels({ thinking_capable: true, thinking_levels: [] })).toEqual(["low", "medium", "high"]);
  });
});

describe("thinkingBudgetApplicable", () => {
  const base = { thinking_capable: true, api_format: "anthropic_messages", thinking_budget_pairs: [{ level: "super", budget_tokens: 2048, max_tokens: 4096 }] };

  it("requires an anthropic endpoint that can think and has at least one pair", () => {
    expect(thinkingBudgetApplicable(base)).toBe(true);
    expect(thinkingBudgetApplicable({ ...base, api_format: "openai_chat" })).toBe(false);
    expect(thinkingBudgetApplicable({ ...base, thinking_capable: false })).toBe(false);
    expect(thinkingBudgetApplicable({ ...base, thinking_budget_pairs: [] })).toBe(false);
  });
});

describe("effectiveThinkingLevel", () => {
  const std = { thinking_levels: [] as string[], api_format: "openai_chat", thinking_mode: "levels" as const, thinking_budget_pairs: [] };
  it("resolves off for incapable endpoints regardless of request", () => {
    const endpoint = { thinking_capable: false, thinking_level: "high", ...std };
    expect(effectiveThinkingLevel(endpoint)).toBe("off");
    expect(effectiveThinkingLevel(endpoint, "high")).toBe("off");
  });

  it("honors allowlisted requested levels", () => {
    const endpoint = { thinking_capable: true, thinking_level: "low", ...std };
    expect(effectiveThinkingLevel(endpoint, "high")).toBe("high");
    expect(effectiveThinkingLevel(endpoint, "medium")).toBe("medium");
  });

  it("falls back to the endpoint level when nothing is requested", () => {
    expect(effectiveThinkingLevel({ thinking_capable: true, thinking_level: "high", ...std })).toBe("high");
  });

  it("resolves illegal levels to off", () => {
    const endpoint = { thinking_capable: true, thinking_level: "ultra", ...std };
    expect(effectiveThinkingLevel(endpoint)).toBe("off");
    expect(effectiveThinkingLevel(endpoint, "ultra")).toBe("off");
    expect(effectiveThinkingLevel(endpoint, null)).toBe("off");
  });

  it("honors vendor-defined levels on every format", () => {
    const openai = { thinking_capable: true, thinking_level: "xhigh", thinking_levels: ["low", "xhigh", "max"], api_format: "openai_chat", thinking_mode: "levels" as const, thinking_budget_pairs: [] };
    expect(effectiveThinkingLevel(openai)).toBe("xhigh");
    expect(effectiveThinkingLevel(openai, "max")).toBe("max");
    expect(effectiveThinkingLevel(openai, "high")).toBe("off");
    const responses = { ...openai, api_format: "openai_responses" };
    expect(effectiveThinkingLevel(responses, "max")).toBe("max");
    // Anthropic keeps the same list semantics: named levels map to budget
    // tokens, numeric levels become budgets, vendor modes ride thinking.type.
    const anthropic = { ...openai, api_format: "anthropic_messages" };
    expect(effectiveThinkingLevel(anthropic, "xhigh")).toBe("xhigh");
    // A configured list replaces the standard set, so unlisted "high" is off.
    expect(effectiveThinkingLevel(anthropic, "high")).toBe("off");
    expect(effectiveThinkingLevel({ ...anthropic, thinking_levels: ["32768"] }, "32768")).toBe("32768");
    expect(effectiveThinkingLevel({ ...anthropic, thinking_levels: ["adaptive"] }, "adaptive")).toBe("adaptive");
  });

  it("budget mode validates against the pair table's level names instead", () => {
    const endpoint = {
      thinking_capable: true,
      thinking_level: "super",
      thinking_levels: ["low", "high"],
      thinking_mode: "budget" as const,
      thinking_budget_pairs: [
        { level: "low", budget_tokens: 1000, max_tokens: 1200 },
        { level: "super", budget_tokens: 500_000, max_tokens: 1_000_000 },
      ],
      api_format: "anthropic_messages",
    };
    expect(effectiveThinkingLevel(endpoint)).toBe("super");
    expect(effectiveThinkingLevel(endpoint, "low")).toBe("low");
    // The levels-mode allowlist does not apply: unlisted-in-pairs means off.
    expect(effectiveThinkingLevel(endpoint, "high")).toBe("off");
    // An empty pair table allows nothing.
    expect(effectiveThinkingLevel({ ...endpoint, thinking_budget_pairs: [] }, "super")).toBe("off");
  });
});
