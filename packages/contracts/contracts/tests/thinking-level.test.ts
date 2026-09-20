/**
 * @file thinking level tests
 * @description Locks effective thinking-level resolution: capability gate and level allowlist.
 */

import { describe, expect, it } from "vitest";
import { effectiveThinkingLevel } from "@agentprism/contracts";

describe("effectiveThinkingLevel", () => {
  it("resolves off for incapable endpoints regardless of request", () => {
    const endpoint = { thinking_capable: false, thinking_level: "high" };
    expect(effectiveThinkingLevel(endpoint)).toBe("off");
    expect(effectiveThinkingLevel(endpoint, "high")).toBe("off");
  });

  it("honors allowlisted requested levels", () => {
    const endpoint = { thinking_capable: true, thinking_level: "low" };
    expect(effectiveThinkingLevel(endpoint, "high")).toBe("high");
    expect(effectiveThinkingLevel(endpoint, "medium")).toBe("medium");
  });

  it("falls back to the endpoint level when nothing is requested", () => {
    expect(effectiveThinkingLevel({ thinking_capable: true, thinking_level: "high" })).toBe("high");
  });

  it("resolves illegal levels to off", () => {
    const endpoint = { thinking_capable: true, thinking_level: "ultra" };
    expect(effectiveThinkingLevel(endpoint)).toBe("off");
    expect(effectiveThinkingLevel(endpoint, "ultra")).toBe("off");
    expect(effectiveThinkingLevel(endpoint, null)).toBe("off");
  });
});
