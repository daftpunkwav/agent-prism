/**
 * @file parse llm endpoint tests
 * @description Covers parseLlmEndpoint clamping and normalizeModelIds hygiene.
 *
 * Responsibilities:
 * - Pin id generation, string truncation, and token-range clamping on read
 * - Lock the enabled/thinking defaults for hand-edited configs
 */

import { describe, expect, it } from "vitest";
import type { IdGenerator } from "@agentprism/contracts";
import { normalizeModelIds, parseLlmEndpoint } from "@agentprism/provider-capability";

const ids: IdGenerator = { next: () => "gen-1" };

describe("parseLlmEndpoint", () => {
  it("parses a fully specified endpoint unchanged", () => {
    const endpoint = parseLlmEndpoint(
      {
        id: "ep-1",
        label: "main",
        provider_name: "acme",
        api_key: "k",
        base_url: "https://api.acme.com/v1",
        use_full_url: true,
        api_format: "openai_chat",
        auth_field: "Authorization",
        model: "gpt-x",
        context_window: 200_000,
        max_input_tokens: 180_000,
        max_output_tokens: 8_192,
        website_url: "https://acme.com",
        thinking_capable: true,
        image_input: true,
        video_input: true,
        enabled: true,
        thinking_level: "high",
      },
      ids,
    );
    expect(endpoint.model).toBe("gpt-x");
    expect(endpoint.api_format).toBe("openai_chat");
    expect(endpoint.thinking_level).toBe("high");
    expect(endpoint.enabled).toBe(true);
  });

  it("generates ids and applies defaults for empty fragments", () => {
    const endpoint = parseLlmEndpoint({}, ids);
    expect(endpoint.id).toBe("gen-1");
    expect(endpoint.base_url).not.toBe("");
    expect(endpoint.model).not.toBe("");
    expect(endpoint.api_format).toBe("anthropic_messages"); // default format
    expect(endpoint.auth_field).toBe("ANTHROPIC_AUTH_TOKEN");
    expect(endpoint.enabled).toBe(true); // hand-edited configs keep their models
  });

  it("clamps out-of-range token windows and non-numeric junk to limits/fallbacks", () => {
    const endpoint = parseLlmEndpoint(
      { context_window: 5, max_input_tokens: 99_999_999, max_output_tokens: "nonsense" },
      ids,
    );
    expect(endpoint.context_window).toBe(1024); // min
    expect(endpoint.max_input_tokens).toBe(10_000_000); // max
    expect(endpoint.max_output_tokens).toBe(96_000); // fallback for junk
  });

  it("truncates oversized strings and blanks fall back to defaults", () => {
    const endpoint = parseLlmEndpoint({ model: "m".repeat(400), label: 42 }, ids);
    expect(endpoint.model.length).toBe(200);
    expect(endpoint.label).toBe(""); // non-string reads as fallback
  });
});

describe("normalizeModelIds", () => {
  it("trims, drops empties/non-strings, and dedupes order-preserving", () => {
    expect(normalizeModelIds(["  b ", "a", "b", "", 7, null, "a"])).toEqual(["b", "a"]);
    expect(normalizeModelIds("nope")).toEqual([]);
    expect(normalizeModelIds(undefined)).toEqual([]);
  });
});
