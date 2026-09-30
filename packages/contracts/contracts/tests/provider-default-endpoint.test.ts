/**
 * @file provider default endpoint tests
 * @description Locks the shared default-endpoint rule: disabled endpoints neither
 *              anchor the default nor receive fallback traffic.
 */

import { describe, expect, it } from "vitest";
import type { LlmEndpoint, ProviderConfig } from "../src/provider-types.js";
import { resolveDefaultEndpoint } from "../src/provider-types.js";

function endpoint(id: string, overrides: Record<string, unknown> = {}): LlmEndpoint {
  return {
    id,
    label: id,
    provider_name: "p",
    api_key: "",
    base_url: `https://${id}.example.com/v1`,
    use_full_url: true,
    api_format: "openai_chat",
    auth_field: "Authorization",
    model: `m-${id}`,
    context_window: 128000,
    max_input_tokens: 120000,
    max_output_tokens: 4096,
    website_url: "",
    thinking_capable: false,
    image_input: false,
    video_input: false,
    enabled: true,
    thinking_level: "off",
    thinking_levels: [],
    thinking_mode: "levels",
    thinking_budget_pairs: [],
    thinking_budget_tokens: 0,
    thinking_max_tokens: 0,
    ...overrides,
  } as LlmEndpoint;
}

function config(endpoints: LlmEndpoint[], defaultEndpointId: string): ProviderConfig {
  return {
    notes: "",
    website_url: "",
    endpoints,
    default_endpoint_id: defaultEndpointId,
    temperature: 0.2,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    max_output_tokens: 512,
    provider_name: "p",
    api_key: "",
    base_url: "",
    use_full_url: true,
    api_format: "openai_chat",
    auth_field: "Authorization",
    model: "",
    models: [],
    context_window: 128000,
    max_input_tokens: 120000,
  };
}

describe("resolveDefaultEndpoint (shared default-endpoint rule)", () => {
  it("an enabled stored default wins", () => {
    const provider = config([endpoint("a"), endpoint("b")], "b");
    expect(resolveDefaultEndpoint(provider)?.id).toBe("b");
  });

  it("a disabled stored default falls back to the first enabled endpoint", () => {
    const provider = config(
      [endpoint("a"), endpoint("b", { enabled: false }), endpoint("c")],
      "b",
    );
    expect(resolveDefaultEndpoint(provider)?.id).toBe("a");
  });

  it("a missing stored default falls back to the first enabled endpoint", () => {
    const provider = config([endpoint("a", { enabled: false }), endpoint("b")], "ghost");
    expect(resolveDefaultEndpoint(provider)?.id).toBe("b");
  });

  it("when nothing is enabled the first configured endpoint returns (fail-loud anchor)", () => {
    // Multi-endpoint case: the nothing-enabled fallback is positional (endpoints[0]),
    // not the stored default — the two are only indistinguishable when a single
    // disabled endpoint happens to be both. Either way the result keeps the
    // pinned-endpoint fail-loud path at model construction intact.
    const provider = config([endpoint("a", { enabled: false }), endpoint("b", { enabled: false })], "b");
    expect(resolveDefaultEndpoint(provider)?.id).toBe("a");
    // Single-endpoint degenerate case resolves to the same anchor.
    expect(resolveDefaultEndpoint(config([endpoint("a", { enabled: false })], "a"))?.id).toBe("a");
  });

  it("no endpoints at all resolves to undefined", () => {
    expect(resolveDefaultEndpoint(config([], ""))).toBeUndefined();
  });
});
