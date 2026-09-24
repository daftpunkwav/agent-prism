/**
 * @file web_fetch tool tests
 * @description Locks web content fetching: HTML-to-text, protocol/url rejection, and the fail-closed outcome mapping.
 *
 * Responsibilities:
 * - Pin htmlToText projection and protocol/url rejection without network
 * - Pin the outcome mapping of every safeFetch failure shape (HTTP status,
 *   UrlValidationError, timeout, caller abort, transport error)
 * - Pin the content-type branch and the max_length consumption
 *
 * No network access: global fetch and node:dns/promises are mocked, responses
 * are real Response objects so the streaming reader path runs for real.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { extractHtmlTitle, htmlToText, setToolTuning, webFetchTool } from "@agentprism/tool-builtins";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

const mockLookup = vi.mocked(lookup);

const EMPTY_WS = { name: "ws", root: "", cwd: () => "", fs: null } as unknown as Parameters<
  typeof webFetchTool.execute
>[0];

/** An AbortError-shaped rejection, matching what AbortSignal.timeout produces. */
function abortError(): Error {
  const error = new Error("This operation was aborted");
  error.name = "AbortError";
  return error;
}

describe("htmlToText", () => {
  it("strips tags, scripts, and entities into readable text", () => {
    const html = "<html><head><style>b{}</style></head><body><h1>Title</h1><p>a &amp; b</p><script>x()</script></body></html>";
    const text = htmlToText(html);
    expect(text).toContain("Title");
    expect(text).toContain("a & b");
    expect(text).not.toContain("script");
    expect(text).not.toContain("b{}");
  });

  it("decodes nested references exactly once", () => {
    expect(htmlToText("<p>&amp;lt;tag&amp;gt;</p>")).toContain("&lt;tag&gt;");
  });
});

describe("extractHtmlTitle", () => {
  it("extracts, entity-decodes, and collapses the first title", () => {
    expect(extractHtmlTitle("<html><head><title>  Example &amp; Co </title></head></html>")).toBe("Example & Co");
    expect(extractHtmlTitle("<TITLE>Upper</TITLE>")).toBe("Upper");
  });

  it("returns empty for a title-less document and caps runaway titles", () => {
    expect(extractHtmlTitle("<html><body><p>no title</p></body></html>")).toBe("");
    expect(extractHtmlTitle(`<title>${"t".repeat(300)}</title>`)).toBe(`${"t".repeat(200)}…`);
  });
});

describe("webFetchTool url gating", () => {
  it("rejects non-http protocols without any network access", async () => {
    const outcome = await webFetchTool.execute(EMPTY_WS, { url: "file:///etc/passwd" });
    expect(outcome.ok).toBe(false);
    expect(outcome.result).toContain("unsupported protocol");
  });

  it("rejects malformed urls", async () => {
    const outcome = await webFetchTool.execute(EMPTY_WS, { url: "not-a-url" });
    expect(outcome.ok).toBe(false);
  });

  it.each([
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.1/admin",
    "http://192.168.1.1/",
    "http://0x0a000001/",
    "http://metadata.google.internal/computeMetadata/v1/",
  ])("rejects SSRF target %s before any network access", async (url) => {
    const outcome = await webFetchTool.execute(EMPTY_WS, { url });
    expect(outcome.ok).toBe(false);
    expect(outcome.result).toContain("not allowed");
  });
});

describe("webFetchTool fetch outcomes", () => {
  beforeEach(() => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // setToolTuning replaces the whole tuning object; reset so later suites in
    // this worker keep the built-in defaults.
    setToolTuning({});
  });

  it("maps a non-2xx response to an HTTP error outcome", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response("nope", { status: 404, statusText: "Not Found", headers: { "content-type": "text/plain" } }),
    );
    const outcome = await webFetchTool.execute(EMPTY_WS, { url: "https://93.184.216.34/x" });
    expect(outcome.ok).toBe(false);
    expect(outcome.result).toContain("Error: HTTP 404 Not Found");
  });

  it("projects html responses to text and returns plain text trimmed", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response("<p>a &amp; b</p>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
    );
    const html = await webFetchTool.execute(EMPTY_WS, { url: "https://93.184.216.34/" });
    expect(html.ok).toBe(true);
    expect(html.result).toBe("a & b");

    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response("  plain body  ", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    const plain = await webFetchTool.execute(EMPTY_WS, { url: "https://93.184.216.34/" });
    expect(plain.ok).toBe(true);
    expect(plain.result).toBe("plain body");
  });

  it("leads html output with the page title when one exists", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response("<html><head><title>Example &amp; Co</title></head><body><p>body text</p></body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    const outcome = await webFetchTool.execute(EMPTY_WS, { url: "https://93.184.216.34/" });
    expect(outcome.ok).toBe(true);
    expect(outcome.result).toMatch(/^Title: Example & Co\n\n/);
    expect(outcome.result).toContain("body text");
  });

  it("caps the returned text at the requested max_length", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response("x".repeat(500), { status: 200, headers: { "content-type": "text/plain" } }),
    );
    const outcome = await webFetchTool.execute(EMPTY_WS, { url: "https://93.184.216.34/", max_length: 100 });
    expect(outcome.ok).toBe(true);
    expect(outcome.result.length).toBeLessThan(200);
  });

  it("maps an AbortError without a caller signal to the tuned timeout message", async () => {
    setToolTuning({ webFetchTimeoutMs: 1234 });
    vi.mocked(globalThis.fetch).mockRejectedValue(abortError());
    const outcome = await webFetchTool.execute(EMPTY_WS, { url: "https://93.184.216.34/" });
    expect(outcome.ok).toBe(false);
    expect(outcome.result).toContain("fetch timed out (1234ms)");
  });

  it("reports an aborted outcome when the caller signal already fired", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.mocked(globalThis.fetch).mockRejectedValue(abortError());
    const outcome = await webFetchTool.execute(EMPTY_WS, { url: "https://93.184.216.34/" }, controller.signal);
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("aborted");
    expect(outcome.result).toBe("Error: aborted");
  });

  it("wraps other transport failures with the reason", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error("ECONNREFUSED"));
    const outcome = await webFetchTool.execute(EMPTY_WS, { url: "https://93.184.216.34/" });
    expect(outcome.ok).toBe(false);
    expect(outcome.result).toContain("fetch failed: ECONNREFUSED");
  });
});
