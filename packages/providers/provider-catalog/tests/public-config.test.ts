/**
 * @file public config tests
 * @description Locks the public projection: masked previews, no raw keys, default lookup.
 */

import { describe, expect, it } from "vitest";
import type { LlmEndpoint, ProviderConfig } from "@agentprism/contracts";
import { resolveDefaultEndpoint, toPublicProviderConfig } from "../src/provider-config.js";

function endpoint(id: string, apiKey: string): LlmEndpoint {
  return { id, label: id, api_key: apiKey } as LlmEndpoint;
}

function config(): ProviderConfig {
  return {
    notes: "",
    website_url: "",
    endpoints: [endpoint("a", "sk-1234567890"), endpoint("b", "")],
    default_endpoint_id: "a",
    temperature: 0.2,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    max_output_tokens: 512,
    provider_name: "p",
    api_key: "sk-1234567890",
    base_url: "",
    use_full_url: true,
    api_format: "openai_chat",
    auth_field: "Authorization",
    model: "m",
    models: ["m2"],
    context_window: 128000,
    max_input_tokens: 120000,
  } as ProviderConfig;
}

describe("toPublicProviderConfig", () => {
  it("masks keys and never leaks raw secrets", () => {
    const view = toPublicProviderConfig(config());
    expect(view.api_key_set).toBe(true);
    expect(view.api_key_preview).toBe("sk-1...7890");
    expect(JSON.stringify(view)).not.toContain("sk-1234567890");
    expect(view.endpoints[0]?.api_key_set).toBe(true);
    expect(view.endpoints[1]?.api_key_set).toBe(false);
  });
});

describe("resolveDefaultEndpoint", () => {
  it("finds the default, falls back to first, undefined when empty", () => {
    const full = config();
    expect(resolveDefaultEndpoint(full)?.id).toBe("a");
    expect(resolveDefaultEndpoint({ ...full, default_endpoint_id: "ghost" })?.id).toBe("a");
    expect(resolveDefaultEndpoint({ ...full, endpoints: [] })).toBeUndefined();
  });
});
