// @vitest-environment jsdom
/**
 * @file settings connection model tests
 * @description Covers the settings form model: grouping, flattening, and local-id rules.
 *
 * Responsibilities:
 * - Pin flat-endpoint grouping by (base_url, api_format) with legacy single-endpoint form
 * - Lock the flatten round trip, including blank-model skips and local-id clearing
 */

import { describe, expect, it } from "vitest";
import type { ProviderConfig } from "@agentprism/client";
import {
  blankConnection,
  blankModel,
  flattenConnections,
  groupEndpoints,
  isLocalModelId,
  newLocalId,
} from "../src/app/settings/settingsConnectionModel";

function endpoint(partial: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "ep-1",
    label: "main",
    provider_name: "acme",
    api_key: "",
    base_url: "https://api.acme.com/v1",
    use_full_url: true,
    api_format: "openai_chat",
    auth_field: "Authorization",
    model: "gpt-x",
    context_window: 128000,
    max_input_tokens: 120000,
    max_output_tokens: 4096,
    thinking_capable: false,
    thinking_level: "off",
    image_input: false,
    video_input: false,
    enabled: true,
    ...partial,
  };
}

function config(endpoints: Array<Record<string, unknown>>): ProviderConfig {
  return {
    provider_name: "acme",
    website_url: "https://acme.com",
    api_key_set: true,
    base_url: "https://api.acme.com/v1",
    use_full_url: true,
    api_format: "openai_chat",
    auth_field: "Authorization",
    model: "legacy-model",
    context_window: 128000,
    max_input_tokens: 120000,
    max_output_tokens: 2048,
    endpoints,
  } as unknown as ProviderConfig;
}

describe("settings connection model", () => {
  it("groups flat endpoints by scheme+host+path and api format", () => {
    const groups = groupEndpoints(config([
      endpoint({ id: "a" }),
      endpoint({ id: "b", base_url: "https://API.ACME.com/v1/" }), // same bucket: host case + trailing slash
      endpoint({ id: "c", base_url: "https://other.example.com/v1", api_format: "anthropic_messages" }),
    ]));
    expect(groups).toHaveLength(2);
    expect(groups[0]?.models.map((m) => m.id)).toEqual(["a", "b"]);
    expect(groups[1]?.api_format).toBe("anthropic_messages");
  });

  it("falls back to a single legacy group when no endpoints exist", () => {
    const groups = groupEndpoints(config([]));
    expect(groups).toHaveLength(1);
    expect(groups[0]?.models[0]).toMatchObject({ id: "legacy", model: "legacy-model", enabled: true });
    expect(groups[0]?.provider_name).toBe("acme");
    expect(groups[0]?.api_key_set).toBe(true);
  });

  it("flattens groups back and clears local ids so blank rows mean create", () => {
    const group = blankConnection();
    group.models[0] = { ...blankModel(), model: "gpt-x" };
    group.models.push(blankModel());
    group.models[1]!.model = "  "; // blank model row is dropped on flatten
    const endpoints = flattenConnections([group]);
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]?.id).toBe(""); // m_-prefixed local id means "create"
    expect(endpoints[0]?.thinking_level).toBe("off");
  });

  it("round-trips vendor-defined thinking levels through flatten and grouping", () => {
    const group = blankConnection();
    group.models[0] = {
      ...blankModel(),
      model: "gpt-x",
      thinking_capable: true,
      thinking_level: "xhigh",
      thinking_levels: ["low", "xhigh"],
    };
    const [out] = flattenConnections([group]);
    expect(out?.thinking_level).toBe("xhigh");
    expect(out?.thinking_levels).toEqual(["low", "xhigh"]);
    const regrouped = groupEndpoints(
      config([endpoint({ thinking_level: "xhigh", thinking_levels: ["low", "xhigh"] })]),
    );
    expect(regrouped[0]?.models[0]).toMatchObject({ thinking_level: "xhigh", thinking_levels: ["low", "xhigh"] });
  });

  it("keeps non-local ids and disables thinking level for incapable models", () => {
    const group = blankConnection();
    group.models[0] = {
      ...blankModel(),
      id: "ep-real",
      model: "gpt-x",
      thinking_capable: true,
      thinking_level: "high",
    };
    const [endpointOut] = flattenConnections([group]);
    expect(endpointOut?.id).toBe("ep-real");
    expect(endpointOut?.thinking_level).toBe("high");
  });

  it("detects locally generated ids", () => {
    expect(isLocalModelId("m_abc")).toBe(true);
    expect(isLocalModelId("new_abc")).toBe(true);
    expect(isLocalModelId("ep-real")).toBe(false);
    expect(newLocalId("c")).toMatch(/^c_[a-z0-9]+$/);
  });
});
