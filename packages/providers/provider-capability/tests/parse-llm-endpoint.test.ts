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
import { normalizeModelIds, normalizeThinkingLevels, parseLlmEndpoint } from "@agentprism/provider-capability";

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

  it("keeps vendor-defined levels and coerces unlisted selections to off", () => {
    const openai = parseLlmEndpoint(
      { api_format: "openai_chat", thinking_level: "xhigh", thinking_levels: ["low", " xhigh ", "", "low", 7, "max"] },
      ids,
    );
    expect(openai.thinking_levels).toEqual(["low", "xhigh", "max"]);
    expect(openai.thinking_level).toBe("xhigh");
    // The list applies to anthropic too: numeric levels become budget tokens,
    // named strings ride thinking.type verbatim.
    const anthropic = parseLlmEndpoint(
      { api_format: "anthropic_messages", thinking_level: "xhigh", thinking_levels: ["low", "xhigh"] },
      ids,
    );
    expect(anthropic.thinking_levels).toEqual(["low", "xhigh"]);
    expect(anthropic.thinking_level).toBe("xhigh");
    // A configured list replaces the standard set, so unlisted "high" is off.
    expect(
      parseLlmEndpoint({ api_format: "anthropic_messages", thinking_level: "high", thinking_levels: ["low", "xhigh"] }, ids)
        .thinking_level,
    ).toBe("off");
    // An unlisted selection still coerces to off on every format.
    expect(
      parseLlmEndpoint({ api_format: "anthropic_messages", thinking_level: "bogus", thinking_levels: ["low"] }, ids)
        .thinking_level,
    ).toBe("off");
  });

  it("normalizes the thinking budget pair and drops a violating output cap", () => {
    const pair = parseLlmEndpoint({ thinking_budget_tokens: 32768, thinking_max_tokens: 64000 }, ids);
    expect(pair.thinking_budget_tokens).toBe(32768);
    expect(pair.thinking_max_tokens).toBe(64000);
    // max <= budget violates the protocol rule: the cap drops to 0 (auto-raise).
    const violating = parseLlmEndpoint({ thinking_budget_tokens: 32768, thinking_max_tokens: 32768 }, ids);
    expect(violating.thinking_budget_tokens).toBe(32768);
    expect(violating.thinking_max_tokens).toBe(0);
    // Absent fields stay unset.
    const unset = parseLlmEndpoint({}, ids);
    expect(unset.thinking_budget_tokens).toBe(0);
    expect(unset.thinking_max_tokens).toBe(0);
  });

  it("preserves the openai_responses format instead of coercing it", () => {
    expect(parseLlmEndpoint({ api_format: "openai_responses" }, ids).api_format).toBe("openai_responses");
    expect(parseLlmEndpoint({ api_format: "openai_chat" }, ids).api_format).toBe("openai_chat");
    expect(parseLlmEndpoint({ api_format: "bogus" }, ids).api_format).toBe("anthropic_messages");
  });

  it("keeps the input verbatim when use_full_url is set; unchecked strips terminal paths as a fallback", () => {
    // Checked (default for API payloads): the operator's input is authoritative.
    expect(parseLlmEndpoint({ base_url: "https://api.acme.com/v1/chat/completions", use_full_url: true }, ids).base_url).toBe(
      "https://api.acme.com/v1/chat/completions",
    );
    expect(parseLlmEndpoint({ base_url: "https://api.acme.com/v1/responses", use_full_url: true }, ids).base_url).toBe(
      "https://api.acme.com/v1/responses",
    );
    // Unchecked: fallback normalization strips the terminal suffix so the SDK
    // appends the right path exactly once.
    expect(
      parseLlmEndpoint({ base_url: "https://api.acme.com/v1/chat/completions", use_full_url: false }, ids).base_url,
    ).toBe("https://api.acme.com/v1");
    expect(parseLlmEndpoint({ base_url: "https://api.acme.com/v1/responses", use_full_url: false }, ids).base_url).toBe(
      "https://api.acme.com/v1",
    );
    expect(parseLlmEndpoint({ base_url: "https://api.acme.com/v1/messages", use_full_url: false }, ids).base_url).toBe(
      "https://api.acme.com/v1",
    );
    // Plain bases and non-terminal segments stay untouched in both modes.
    expect(parseLlmEndpoint({ base_url: "https://api.acme.com/v1" }, ids).base_url).toBe("https://api.acme.com/v1");
    expect(parseLlmEndpoint({ base_url: "https://api.acme.com/responses-proxy/v1", use_full_url: false }, ids).base_url).toBe(
      "https://api.acme.com/responses-proxy/v1",
    );
    // An absent flag (hand-written config files) falls to the stripping fallback.
    expect(parseLlmEndpoint({ base_url: "https://api.acme.com/v1/messages" }, ids).base_url).toBe("https://api.acme.com/v1");
  });
});

describe("normalizeThinkingLevels", () => {
  it("trims, drops empties/non-strings, dedupes, and caps the count", () => {
    expect(normalizeThinkingLevels(["  xhigh ", "", "xhigh", 7, null, "max"])).toEqual(["xhigh", "max"]);
    expect(normalizeThinkingLevels("nope")).toEqual([]);
    expect(normalizeThinkingLevels(undefined)).toEqual([]);
    expect(normalizeThinkingLevels(Array.from({ length: 20 }, (_, i) => `l${i}`))).toHaveLength(16);
  });
});

describe("normalizeModelIds", () => {
  it("trims, drops empties/non-strings, and dedupes order-preserving", () => {
    expect(normalizeModelIds(["  b ", "a", "b", "", 7, null, "a"])).toEqual(["b", "a"]);
    expect(normalizeModelIds("nope")).toEqual([]);
    expect(normalizeModelIds(undefined)).toEqual([]);
  });
});
