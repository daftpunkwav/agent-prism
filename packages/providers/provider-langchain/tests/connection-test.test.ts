/**
 * @file connection test tests
 * @description Covers endpoint selection and probe behavior of testProviderConnection.
 *
 * Responsibilities:
 * - Pin the target selection order (default endpoint, id within set, id-only,
 *   first provided, legacy flat) and the no-endpoint/missing-key fail paths
 * - Pin the BYOK fallback to the stored endpoint key
 * - Lock the real wire success and failure paths (loopback HTTP server / closed port)
 */

import { createServer, type Server } from "node:http";
import { describe, expect, it, afterAll } from "vitest";
import { testProviderConnection } from "../src/connection-test.js";
import type { ConnectionTestTarget, LlmEndpoint, ProviderConfig } from "@agentprism/contracts";

const ids = { next: () => "gen-id" };

function endpoint(partial: Partial<LlmEndpoint>): LlmEndpoint {
  return {
    id: "ep-1",
    label: "ep",
    provider_name: "",
    api_key: "stored-key",
    base_url: "http://127.0.0.1:9/v1", // closed port: any real probe fails fast
    use_full_url: false,
    api_format: "openai_chat",
    auth_field: "",
    model: "test-model",
    context_window: 128_000,
    max_input_tokens: 120_000,
    max_output_tokens: 4096,
    website_url: "",
    thinking_capable: false,
    image_input: false,
    video_input: false,
    enabled: true,
    thinking_level: "off",
    ...partial,
  } as LlmEndpoint;
}

function provider(endpoints: LlmEndpoint[], defaultEndpointId = ""): ProviderConfig {
  return {
    api_key: "",
    base_url: "",
    api_format: "openai_chat",
    auth_field: "",
    model: "",
    temperature: 0,
    max_output_tokens: 2048,
    endpoints,
    default_endpoint_id: defaultEndpointId,
  } as unknown as ProviderConfig;
}

// One loopback server answers the OpenAI-style chat wire for the success probes.
let server: Server | null = null;
let serverUrl = "http://127.0.0.1:9/v1";
const started = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (req.url !== undefined && req.url.includes("/responses")) {
      res.end(
        JSON.stringify({
          id: "resp_1",
          object: "response",
          output: [
            {
              type: "message",
              id: "m1",
              role: "assistant",
              content: [{ type: "output_text", text: "pong from responses", annotations: [] }],
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        }),
      );
      return;
    }
    if (req.url !== undefined && req.url.includes("/echo-auth")) {
      res.statusCode = 401;
      res.end(
        JSON.stringify({
          error: { message: `bad key, got header '${String(req.headers.authorization ?? "")}'`, type: "invalid_request_error" },
        }),
      );
      return;
    }
    res.end(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "pong from loopback" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
});
afterAll(async () => {
  if (server !== null) await new Promise<void>((resolve) => server?.close(() => resolve()));
});

async function loopbackUrl(): Promise<string> {
  if (server === null) {
    server = started;
    await new Promise<void>((resolve) => started.listen(0, "127.0.0.1", resolve));
    const address = started.address();
    if (address !== null && typeof address === "object") {
      serverUrl = `http://127.0.0.1:${address.port}/v1`;
    }
  }
  return serverUrl;
}

describe("testProviderConnection endpoint selection", () => {
  it("reports no endpoint when there is nothing to select", async () => {
    const result = await testProviderConnection({ provider: provider([]), idGenerator: ids }, null);
    expect(result).toEqual({ ok: false, message: "No endpoint found to test", model: "" });
  });

  it("reports no endpoint when the requested test id is not among the provided set", async () => {
    const result = await testProviderConnection(
      { provider: provider([]), idGenerator: ids },
      { testEndpointId: "missing", endpoints: [{ id: "ep-1" } as never] },
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe("No endpoint found to test");
  });

  it("falls back to the default stored endpoint for a null target", async () => {
    const result = await testProviderConnection(
      { provider: provider([endpoint({ api_key: "" })], "ep-1"), idGenerator: ids },
      null,
    );
    // Key-less stored endpoint with itself as fallback: the probe fails on the key guard.
    expect(result).toEqual({ ok: false, message: "Please provide an API Key first", model: "test-model" });
  });

  it("keeps an empty key when no stored endpoint can fill it (BYOK guard)", async () => {
    const target: ConnectionTestTarget = { endpoints: [{ id: "fresh", api_key: "" } as never] };
    const result = await testProviderConnection({ provider: provider([]), idGenerator: ids }, target);
    // id "fresh" matches no stored endpoint, so the key stays empty and the guard fires.
    expect(result).toEqual({ ok: false, message: "Please provide an API Key first", model: "step-3.7-flash" });
  });

  it("inherits the stored key for a key-less payload (BYOK) and probes with it", async () => {
    const url = await loopbackUrl();
    const stored = provider([
      endpoint({ id: "ep-1", api_key: "stored-key", base_url: url }),
    ], "ep-1");
    const target: ConnectionTestTarget = {
      endpoints: [{ id: "ep-1", api_key: "", base_url: url, api_format: "openai_chat" } as never],
    };
    const result = await testProviderConnection({ provider: stored, idGenerator: ids }, target);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Connection succeeded");
    expect(result.message).toContain("pong from loopback");
    // The reported model is the constructed (update payload) endpoint's model,
    // which defaults when the payload omits it.
    expect(result.model).toBe("step-3.7-flash");
  });

  it("surfaces sanitized failures from a real closed port as Connection failed", async () => {
    const target: ConnectionTestTarget = { endpoints: [{ id: "ep-1", api_key: "k" } as never] };
    const result = await testProviderConnection(
      { provider: provider([]), idGenerator: ids },
      target,
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Connection failed:");
  });

  it("uses the first provided endpoint when only the set is given (legacy flat too)", async () => {
    const url = await loopbackUrl();
    const target: ConnectionTestTarget = {
      endpoints: [{ id: "", api_key: "direct-key", base_url: url, api_format: "openai_chat" } as never],
    };
    const result = await testProviderConnection({ provider: provider([]), idGenerator: ids }, target);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("pong from loopback");

    const legacy = await testProviderConnection(
      { provider: provider([]), idGenerator: ids },
      // The legacy branch is reachable only when the id is the empty string
      // (defined-but-empty bypasses the id branches) and the set is absent.
      { testEndpointId: "", legacy: { id: "", api_key: "direct-key", base_url: url, api_format: "openai_chat" } as never },
    );
    expect(legacy.ok).toBe(true);
  });

  it("probes openai_responses endpoints through the Responses API", async () => {
    const url = await loopbackUrl();
    const target: ConnectionTestTarget = {
      endpoints: [{ id: "", api_key: "direct-key", base_url: url, api_format: "openai_responses" } as never],
    };
    const result = await testProviderConnection({ provider: provider([]), idGenerator: ids }, target);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("pong from responses");
  });

  it("reports the redacted failure detail instead of a bare error name", async () => {
    const url = `${await loopbackUrl()}/echo-auth`;
    const key = "sk-test-secret-key";
    const target: ConnectionTestTarget = {
      endpoints: [{ id: "", api_key: key, base_url: url, api_format: "openai_chat" } as never],
    };
    const result = await testProviderConnection({ provider: provider([]), idGenerator: ids }, target);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Connection failed:");
    expect(result.message).not.toBe("Connection failed: Error");
    expect(result.message).not.toContain(key);
  });

  it("selects a stored endpoint by id when the target pins testEndpointId", async () => {
    const url = await loopbackUrl();
    const stored = provider([
      endpoint({ id: "other", base_url: "http://127.0.0.1:9/v1", api_key: "k" }),
      endpoint({ id: "ep-1", base_url: url, api_key: "k" }),
    ], "other");
    const result = await testProviderConnection({ provider: stored, idGenerator: ids }, { testEndpointId: "ep-1" });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("pong from loopback");
  });
});
