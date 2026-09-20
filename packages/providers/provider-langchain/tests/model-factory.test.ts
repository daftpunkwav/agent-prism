/**
 * @file model factory tests
 * @description Covers createChatModel and toLlmAdapter.
 *
 * Responsibilities:
 * - Verify timeout unit handling
 * - Pin the adapter mapping
 * - Pin invalid base URLs throwing ConfigurationError without echoing the URL
 */

import { describe, expect, it } from "vitest";
import { createChatModel, createColumnModel, LLM_TIMEOUT_MS, toLlmAdapter } from "@agentprism/provider-langchain";
import { ConfigurationError, PipelineConfigSchema } from "@agentprism/contracts";
import type { ProviderConfig } from "@agentprism/contracts";

/** Minimal config for createChatModel; unrelated fields are ignored by assertions. */
function fixture(apiFormat: string): ProviderConfig {
  return {
    api_key: "test-key",
    base_url: "http://127.0.0.1:9/v1",
    api_format: apiFormat,
    auth_field: "",
    model: "test-model",
    temperature: 0,
    max_output_tokens: 2048,
    endpoints: [],
    default_endpoint_id: "",
  } as unknown as ProviderConfig;
}

describe("createColumnModel disabled endpoint", () => {
  it("fails loud when the pinned endpoint is disabled in settings", () => {
    const provider = {
      ...fixture("openai_chat"),
      endpoints: [
        {
          id: "ep-off",
          label: "off",
          provider_name: "",
          api_key: "k",
          base_url: "https://disabled.example.com/v1",
          use_full_url: false,
          api_format: "openai_chat",
          auth_field: "",
          model: "m",
          context_window: 128000,
          max_input_tokens: 120000,
          max_output_tokens: 4096,
          website_url: "",
          thinking_capable: false,
          image_input: false,
          video_input: false,
          enabled: false,
          thinking_level: "off",
        },
      ],
      default_endpoint_id: "ep-off",
    } as unknown as ProviderConfig;
    const config = PipelineConfigSchema.parse({ label: "col", harness: "bare", endpoint_id: "ep-off" });
    expect(() => createColumnModel({ provider }, config)).toThrow(ConfigurationError);
  });

  it("keeps building the model when the endpoint is enabled", () => {
    const provider = {
      ...fixture("openai_chat"),
      endpoints: [
        {
          id: "ep-on",
          label: "on",
          provider_name: "",
          api_key: "k",
          base_url: "https://enabled.example.com/v1",
          use_full_url: false,
          api_format: "openai_chat",
          auth_field: "",
          model: "m",
          context_window: 128000,
          max_input_tokens: 120000,
          max_output_tokens: 4096,
          website_url: "",
          thinking_capable: false,
          image_input: false,
          video_input: false,
          enabled: true,
          thinking_level: "off",
        },
      ],
      default_endpoint_id: "ep-on",
    } as unknown as ProviderConfig;
    const config = PipelineConfigSchema.parse({ label: "col", harness: "bare", endpoint_id: "ep-on" });
    const bundle = createColumnModel({ provider }, config);
    expect(bundle.contextWindow).toBe(128000);
  });
});

describe("createChatModel timeout units", () => {
  it("openai_chat timeout is milliseconds (120000 not 120)", () => {
    const model = createChatModel({ provider: fixture("openai_chat") });
    expect((model as unknown as { timeout?: number }).timeout).toBe(LLM_TIMEOUT_MS);
  });

  it("anthropic timeout matches openai branch", () => {
    const model = createChatModel({ provider: fixture("anthropic") });
    expect((model as unknown as { clientOptions?: { timeout?: number } }).clientOptions?.timeout).toBe(
      LLM_TIMEOUT_MS,
    );
  });

  it("injected timeout and retry count reach both SDK branches", () => {
    // The SDKs surface the retry count on the shared AsyncCaller, not as an own model property.
    const openai = createChatModel({ provider: fixture("openai_chat"), timeoutMs: 5_000, maxRetries: 1 });
    expect((openai as unknown as { timeout?: number }).timeout).toBe(5_000);
    expect((openai as unknown as { caller?: { maxRetries?: number } }).caller?.maxRetries).toBe(1);

    const anthropic = createChatModel({ provider: fixture("anthropic"), timeoutMs: 5_000, maxRetries: 1 });
    expect((anthropic as unknown as { clientOptions?: { timeout?: number } }).clientOptions?.timeout).toBe(5_000);
    expect((anthropic as unknown as { caller?: { maxRetries?: number } }).caller?.maxRetries).toBe(1);
  });
});

describe("createChatModel credential references", () => {
  it("missing-variable reference fails closed with ConfigurationError", () => {
    const provider = { ...fixture("openai_chat"), api_key: "${env:DEFINITELY_MISSING_XYZ}" };
    expect(() => createChatModel({ provider })).toThrow(ConfigurationError);
  });

  it("resolves references from the environment at construction", () => {
    process.env.AGENTPRISM_TEST_CRED = "test-secret";
    try {
      const provider = { ...fixture("openai_chat"), api_key: "${env:AGENTPRISM_TEST_CRED}" };
      const model = createChatModel({ provider });
      expect((model as unknown as { apiKey?: string }).apiKey).toBe("test-secret");
    } finally {
      delete process.env.AGENTPRISM_TEST_CRED;
    }
  });
});

describe("toLlmAdapter", () => {
  it("exposes invoke/stream without leaking BaseChatModel on the adapter surface", () => {
    const model = createChatModel({ provider: fixture("openai_chat") });
    const adapter = toLlmAdapter(model);
    expect(typeof adapter.invoke).toBe("function");
    expect(typeof adapter.stream).toBe("function");
    expect(adapter).not.toHaveProperty("bindTools");
  });
});

describe("createChatModel base_url failure", () => {
  it("invalid base_url throws ConfigurationError with a fixed message (never echoes the URL)", () => {
    const provider = { ...fixture("openai_chat"), base_url: "https://user:secret@example.com:99999/v1" };
    try {
      createChatModel({ provider });
      expect.unreachable("expected createChatModel to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as Error).message).toBe("Provider base_url is invalid; check Provider settings");
      expect((error as Error).message).not.toContain("secret");
    }
  });
});
