/**
 * @file parse provider config tests
 * @description Locks config parsing: legacy migration, clamping, dedup, mirrors.
 */

import { describe, expect, it } from "vitest";
import type { LlmEnvSeed } from "@agentprism/config";
import { DECODE_FIELD_RANGES } from "@agentprism/contracts";
import { parseProviderConfig } from "../src/provider-config.js";

function seed(): LlmEnvSeed {
  return {
    providerName: "seed-provider",
    apiKey: "",
    baseUrl: "",
    model: "seed-model",
    apiFormat: "anthropic_messages",
    temperature: 0.2,
  };
}

const ids = { next: () => "id1" };

describe("parseProviderConfig", () => {
  it("migrates empty input to one seed endpoint with mirrored fields", () => {
    const config = parseProviderConfig({}, seed(), ids);
    expect(config.endpoints).toHaveLength(1);
    expect(config.default_endpoint_id).toBe(config.endpoints[0]?.id);
    expect(config.provider_name).toBe("seed-provider");
    expect(config.model).toBe("seed-model");
    expect(config.models).toEqual([]);
  });

  it("clamps decode values and falls back to seed on garbage", () => {
    const clamped = parseProviderConfig({ temperature: 99 }, seed(), ids);
    expect(clamped.temperature).toBe(DECODE_FIELD_RANGES.temperature.max);
    const fallback = parseProviderConfig({ temperature: "hot" }, seed(), ids);
    expect(fallback.temperature).toBe(0.2);
  });

  it("rejects duplicate models under one connection", () => {
    const endpoint = {
      id: "a",
      base_url: "https://api.example.com/v1",
      use_full_url: true,
      api_format: "openai_chat",
      auth_field: "Authorization",
      model: "m",
    };
    expect(() =>
      parseProviderConfig({ endpoints: [endpoint, { ...endpoint, id: "b" }] }, seed(), ids),
    ).toThrow(/Duplicate model/);
  });
});
