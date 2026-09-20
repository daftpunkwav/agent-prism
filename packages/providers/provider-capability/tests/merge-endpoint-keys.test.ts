/**
 * @file mergeEndpointKeys tests
 * @description Locks stored-key inheritance by id and connection fingerprint.
 *
 * Responsibilities:
 * - Pin inheritance of stored keys onto endpoints with empty keys
 */

import { describe, expect, it } from "vitest";
import { mergeEndpointKeys, connectionFingerprint } from "@agentprism/provider-capability";

describe("mergeEndpointKeys fingerprint inheritance", () => {
  const existing = [
    {
      id: "ep1",
      base_url: "https://api.openai.com/v1",
      api_format: "openai_chat",
      api_key: "sk-existing",
      model: "gpt-4",
    },
  ] as any[];

  it("empty key inherits by id match", () => {
    const incoming = [{ id: "ep1", base_url: "https://api.openai.com/v1", api_format: "openai_chat", api_key: "" }];
    const result = mergeEndpointKeys(incoming, existing);
    expect(result[0]!.api_key).toBe("sk-existing");
  });

  it("empty key inherits by connection fingerprint (same base_url + api_format)", () => {
    const incoming = [{ id: "ep2", base_url: "https://api.openai.com/v1", api_format: "openai_chat", api_key: "" }];
    const result = mergeEndpointKeys(incoming, existing);
    expect(result[0]!.api_key).toBe("sk-existing");
  });

  it("different api_format does not inherit (fingerprint mismatch)", () => {
    const incoming = [{ id: "ep2", base_url: "https://api.openai.com/v1", api_format: "anthropic_messages", api_key: "" }];
    const result = mergeEndpointKeys(incoming, existing);
    expect(result[0]!.api_key).toBe("");
  });

  it("different base_url does not inherit (fingerprint mismatch)", () => {
    const incoming = [{ id: "ep2", base_url: "https://api.anthropic.com", api_format: "openai_chat", api_key: "" }];
    const result = mergeEndpointKeys(incoming, existing);
    expect(result[0]!.api_key).toBe("");
  });

  it("non-empty key does not inherit (explicit key wins)", () => {
    const incoming = [{ id: "ep1", base_url: "https://api.openai.com/v1", api_format: "openai_chat", api_key: "sk-new" }];
    const result = mergeEndpointKeys(incoming, existing);
    expect(result[0]!.api_key).toBe("sk-new");
  });

  it("id match takes priority over fingerprint match", () => {
    const multiExisting = [
      ...existing,
      { id: "ep2", base_url: "https://other.com/v1", api_format: "openai_chat", api_key: "sk-other" },
    ];
    // ep2 id matches sk-other even though fingerprint also matches ep1
    const incoming = [{ id: "ep2", base_url: "https://api.openai.com/v1", api_format: "openai_chat", api_key: "" }];
    const result = mergeEndpointKeys(incoming, multiExisting);
    expect(result[0]!.api_key).toBe("sk-other");
  });

  it("connectionFingerprint normalizes base_url", () => {
    const fp1 = connectionFingerprint({ base_url: "https://API.OpenAI.COM/v1/", api_format: "openai_chat" });
    const fp2 = connectionFingerprint({ base_url: "https://api.openai.com/v1", api_format: "openai_chat" });
    expect(fp1).toBe(fp2);
  });
});
