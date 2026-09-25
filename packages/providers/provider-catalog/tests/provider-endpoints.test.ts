/**
 * @file provider endpoint tests
 * @description Covers parseLlmEndpoint normalization.
 *
 * Responsibilities:
 * - Pin read-side normalization of thinking_level
 */

import { describe, expect, it } from "vitest";
import type { IdGenerator } from "@agentprism/contracts";
import { connectionFingerprint, normalizeBaseUrl, parseLlmEndpoint } from "@agentprism/provider-catalog";

const ids: IdGenerator = { next: () => "gen-id" };

describe("parseLlmEndpoint thinking_level read-side normalize", () => {
  it("illegal levels normalize to off (no longer echoed as-is)", () => {
    const endpoint = parseLlmEndpoint({ thinking_capable: true, thinking_level: "ultra" }, ids);
    expect(endpoint.thinking_level).toBe("off");
  });

  it("valid levels and defaults stay unchanged", () => {
    expect(parseLlmEndpoint({ thinking_capable: true, thinking_level: "high" }, ids).thinking_level).toBe("high");
    expect(parseLlmEndpoint({}, ids).thinking_level).toBe("off");
    expect(parseLlmEndpoint({ thinking_level: null }, ids).thinking_level).toBe("off");
  });

  it("when capability is off, stored levels are not collapsed (re-enable restores the level)", () => {
    const endpoint = parseLlmEndpoint({ thinking_capable: false, thinking_level: "medium" }, ids);
    expect(endpoint.thinking_level).toBe("medium");
  });

  it("enabled defaults to true and survives the explicit false", () => {
    expect(parseLlmEndpoint({}, ids).enabled).toBe(true);
    expect(parseLlmEndpoint({ enabled: true }, ids).enabled).toBe(true);
    expect(parseLlmEndpoint({ enabled: false }, ids).enabled).toBe(false);
    // Pre-flag hand-edited configs (field absent) must not lose their models.
    expect(parseLlmEndpoint({ enabled: undefined }, ids).enabled).toBe(true);
  });
});

describe("normalizeBaseUrl equivalence contract (mirrored by connKey in apps/web settingsConnectionModel)", () => {
  it("scheme and host are case-insensitive; path stays case-sensitive", () => {
    expect(normalizeBaseUrl("https://API.Example.COM/v1")).toBe("https://api.example.com/v1");
    expect(normalizeBaseUrl("https://api.example.com/V1")).toBe("https://api.example.com/V1");
    expect(normalizeBaseUrl("https://api.example.com/V1")).not.toBe(normalizeBaseUrl("https://api.example.com/v1"));
  });

  it("strips trailing slashes and surrounding whitespace", () => {
    expect(normalizeBaseUrl("  https://api.example.com/v1///  ")).toBe("https://api.example.com/v1");
  });

  it("unparseable input falls back to fully lowercased trim", () => {
    expect(normalizeBaseUrl("  NOT-A-URL/Path  ")).toBe("not-a-url/path");
  });

  it("connectionFingerprint appends the api format", () => {
    expect(connectionFingerprint({ base_url: "https://API.example.com/v1/", api_format: "openai_chat" })).toBe(
      "https://api.example.com/v1::openai_chat",
    );
  });
});
