/**
 * @file thinking level tests
 * @description Locks effective thinking-level resolution: capability gate and level allowlist.
 */

import { describe, expect, it } from "vitest";
import { effectiveThinkingLevel } from "@agentprism/contracts";

describe("effectiveThinkingLevel", () => {
  const std = { thinking_levels: [] as string[], api_format: "openai_chat" };
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
    const openai = { thinking_capable: true, thinking_level: "xhigh", thinking_levels: ["low", "xhigh", "max"], api_format: "openai_chat" };
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
});
