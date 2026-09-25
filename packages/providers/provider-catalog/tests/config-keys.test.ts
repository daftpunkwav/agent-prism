/**
 * @file config keys tests
 * @description Locks key handling: masking previews and empty-key inheritance.
 */

import { describe, expect, it } from "vitest";
import type { LlmEndpoint } from "@agentprism/contracts";
import { maskApiKey, mergeEndpointKeys } from "../src/provider-config.js";

describe("maskApiKey", () => {
  it("keeps empty empty and shorts short keys", () => {
    expect(maskApiKey("")).toBe("");
    expect(maskApiKey("12345678")).toBe("<short>");
  });

  it("shows first/last four of long keys", () => {
    expect(maskApiKey("sk-1234567890")).toBe("sk-1...7890");
  });
});

describe("mergeEndpointKeys", () => {
  // Minimal stored entity: mergeEndpointKeys only reads id/base_url/api_format/api_key.
  const stored = {
    id: "ep1",
    base_url: "https://api.example.com/v1",
    api_format: "openai_chat",
    api_key: "stored-key",
  } as LlmEndpoint;

  it("inherits by endpoint id", () => {
    const merged = mergeEndpointKeys(
      [{ id: "ep1", base_url: "https://other.example/v1", api_format: "openai_chat", api_key: "" }],
      [stored],
    );
    expect(merged[0]?.api_key).toBe("stored-key");
  });

  it("inherits by connection fingerprint across ids", () => {
    const merged = mergeEndpointKeys(
      [{ id: "ep2", base_url: stored.base_url, api_format: stored.api_format, api_key: "" }],
      [stored],
    );
    expect(merged[0]?.api_key).toBe("stored-key");
  });

  it("keeps explicit keys as-is", () => {
    const merged = mergeEndpointKeys(
      [{ id: "ep1", base_url: stored.base_url, api_format: stored.api_format, api_key: "fresh" }],
      [stored],
    );
    expect(merged[0]?.api_key).toBe("fresh");
  });
});
