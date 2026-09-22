/**
 * @file provider mapping tests
 * @description Locks public-view to update-payload mapping: keys never stored, overrides win.
 */

import { describe, expect, it } from "vitest";
import { LlmEndpointPublicSchema, ProviderConfigPublicSchema } from "@agentprism/contracts";
import { endpointUpdateFromPublic, providerUpdateFromPublic } from "../src/provider-mapping.js";

function publicEndpoint() {
  return LlmEndpointPublicSchema.parse({
    id: "ep1",
    label: "Main",
    provider_name: "acme",
    base_url: "https://api.example.com/v1",
    use_full_url: true,
    api_format: "openai_chat",
    auth_field: "Authorization",
    model: "m1",
  });
}

describe("endpointUpdateFromPublic", () => {
  it("carries fields over and blanks the key (backend keeps stored key by id)", () => {
    const update = endpointUpdateFromPublic(publicEndpoint());
    expect(update.id).toBe("ep1");
    expect(update.label).toBe("Main");
    expect(update.model).toBe("m1");
    expect(update.api_key).toBe("");
  });

  it("keeps vendor-defined thinking levels on the round trip", () => {
    const update = endpointUpdateFromPublic({
      ...publicEndpoint(),
      thinking_level: "xhigh",
      thinking_levels: ["low", "xhigh"],
    });
    expect(update.thinking_level).toBe("xhigh");
    expect(update.thinking_levels).toEqual(["low", "xhigh"]);
  });
});

describe("providerUpdateFromPublic", () => {
  it("round-trips endpoints and blanks stored secrets", () => {
    const config = ProviderConfigPublicSchema.parse({
      notes: "n",
      website_url: "",
      temperature: 0.2,
      max_output_tokens: 512,
      provider_name: "acme",
      api_key_set: true,
      api_key_preview: "sk-…",
      base_url: "https://api.example.com/v1",
      use_full_url: true,
      api_format: "openai_chat",
      auth_field: "Authorization",
      model: "m1",
      context_window: 128000,
      max_input_tokens: 120000,
      endpoints: [
        {
          id: "ep1",
          base_url: "https://api.example.com/v1",
          use_full_url: true,
          api_format: "openai_chat",
          auth_field: "Authorization",
          model: "m1",
        },
      ],
    });
    const update = providerUpdateFromPublic(config);
    expect(update.endpoints).toHaveLength(1);
    expect(update.endpoints[0]?.id).toBe("ep1");
    expect(update.endpoints[0]?.api_key).toBe("");
    expect(update.api_key).toBe("");
    expect(update.temperature).toBe(0.2);
  });

  it("explicit overrides win over public values", () => {
    const config = ProviderConfigPublicSchema.parse({
      notes: "n",
      website_url: "",
      temperature: 0.2,
      max_output_tokens: 512,
      provider_name: "acme",
      api_key_set: false,
      api_key_preview: "",
      base_url: "",
      use_full_url: true,
      api_format: "openai_chat",
      auth_field: "Authorization",
      model: "m1",
      context_window: 128000,
      max_input_tokens: 120000,
    });
    const update = providerUpdateFromPublic(config, { temperature: 0.9 });
    expect(update.temperature).toBe(0.9);
  });
});
