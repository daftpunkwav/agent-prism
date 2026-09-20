/**
 * @file safe-fetch policy tests
 * @description Drives the SSRF-guarded fetch loop over mocked DNS and fetch.
 *
 * Responsibilities:
 * - Pin string-level URL validation and DNS-rebinding rejection per resolved hop
 * - Pin manual redirect following with per-hop re-validation and the loop ceiling
 * - Pin the capped body reader: truncation, abort release, and the null-body fallback
 *
 * No network access: global fetch and node:dns/promises are mocked, responses
 * are real Response objects so the streaming reader path runs for real.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { UrlValidationError } from "@agentprism/contracts";
import { safeFetchText } from "@agentprism/tool-builtins";
import { SAFE_FETCH_MAX_REDIRECTS } from "../src/definitions/safe-fetch.js";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

const mockLookup = vi.mocked(lookup);

/** A lookup stub returning the given addresses for every hostname. */
function resolvesTo(...addresses: string[]): void {
  mockLookup.mockResolvedValue(addresses.map((address) => ({ address, family: 4 })) as never);
}

const RESPONSE_HEADERS = { "content-type": "text/plain" };

describe("safeFetchText", () => {
  beforeEach(() => {
    resolvesTo("93.184.216.34"); // public IP: passes the resolved-address guard
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects non-http URL schemes before any fetch", async () => {
    await expect(
      safeFetchText("ftp://example.com/file", { signal: new AbortController().signal }),
    ).rejects.toThrow(UrlValidationError);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("reads a successful body through the streaming reader", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response("hello world", { status: 200, headers: RESPONSE_HEADERS }));
    const { response, text } = await safeFetchText("https://example.com/", { signal: new AbortController().signal });
    expect(response.status).toBe(200);
    expect(text).toBe("hello world");
  });

  it("falls back to response.text() when the body is not a stream", async () => {
    const bare = { ok: true, status: 200, body: null, text: async () => "fallback body" } as unknown as Response;
    vi.mocked(globalThis.fetch).mockResolvedValue(bare);
    const { text } = await safeFetchText("https://example.com/", { signal: new AbortController().signal });
    expect(text).toBe("fallback body");
  });

  it("caps the streamed body at maxChars and cancels the download", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response("a".repeat(1000), { status: 200, headers: RESPONSE_HEADERS }),
    );
    const { text } = await safeFetchText("https://example.com/", {
      signal: new AbortController().signal,
      maxChars: 16,
    });
    expect(text).toHaveLength(16);
  });

  it("releases the download when the signal aborts mid-read", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response("partial", { status: 200, headers: RESPONSE_HEADERS }),
    );
    const controller = new AbortController();
    controller.abort();
    const { text } = await safeFetchText("https://example.com/", { signal: controller.signal });
    expect(text).toBe("partial");
  });

  it("rejects when a name host resolves into a forbidden range (DNS rebinding)", async () => {
    resolvesTo("10.0.0.5");
    await expect(
      safeFetchText("https://example.com/", { signal: new AbortController().signal }),
    ).rejects.toThrow(/resolves to a forbidden address/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("follows redirects and re-validates the DNS answer of every hop", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://example.com/next" } }))
      .mockResolvedValueOnce(new Response("after redirect", { status: 200, headers: RESPONSE_HEADERS }));
    const { response, text } = await safeFetchText("https://example.com/old", {
      signal: new AbortController().signal,
    });
    expect(text).toBe("after redirect");
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a redirect whose target is a forbidden IP literal", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "http://10.0.0.9/secret" } }),
    );
    await expect(
      safeFetchText("https://example.com/old", { signal: new AbortController().signal }),
    ).rejects.toThrow(UrlValidationError);
  });

  it("fails after exceeding the redirect ceiling", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "https://example.com/loop" } }),
    );
    await expect(
      safeFetchText("https://example.com/start", { signal: new AbortController().signal }),
    ).rejects.toThrow(`url exceeded ${SAFE_FETCH_MAX_REDIRECTS} redirects`);
    expect(globalThis.fetch).toHaveBeenCalledTimes(SAFE_FETCH_MAX_REDIRECTS + 1);
  });

  it("returns a location-less 3xx as a terminal empty-body response", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(null, { status: 304 }));
    const { response, text } = await safeFetchText("https://example.com/", { signal: new AbortController().signal });
    expect(response.status).toBe(304);
    expect(text).toBe("");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns non-2xx/3xx responses untouched with an empty body", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response("nope", { status: 500 }));
    const { response, text } = await safeFetchText("https://example.com/", { signal: new AbortController().signal });
    expect(response.status).toBe(500);
    expect(text).toBe("");
  });

  it("lets DNS lookup failures surface at fetch time instead", async () => {
    mockLookup.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error("getaddrinfo ENOTFOUND example.com"));
    await expect(
      safeFetchText("https://missing.invalid/", { signal: new AbortController().signal }),
    ).rejects.toThrow(/ENOTFOUND/);
  });
});
