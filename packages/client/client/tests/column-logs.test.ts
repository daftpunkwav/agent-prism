/**
 * @file column logs client tests
 * @description Pins the polled column-logs fetcher: query mapping and shape
 * degradation for malformed 200 JSON bodies.
 *
 * Responsibilities:
 * - Lock query-param encoding and the empty-logs fallback for bad 200 bodies
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchColumnLogs } from "@agentprism/client";

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return vi.fn((async (url: string | URL, init?: RequestInit) => handler(String(url), init)) as unknown as typeof fetch);
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchColumnLogs", () => {
  it("encodes workspace and label as query params", async () => {
    let seen = "";
    vi.stubGlobal(
      "fetch",
      stubFetch((url) => {
        seen = url;
        return jsonResponse({ workspace: "ws1", label: "Lane", events: [], wire: [], truncated: false });
      }),
    );
    await fetchColumnLogs("ws 1", "a/b");
    expect(seen).toContain("/api/arena/column-logs?");
    expect(seen).toContain("workspace=ws+1");
    expect(seen).toContain("label=a%2Fb");
  });

  it("degrades a malformed 200 body to empty logs instead of throwing", async () => {
    vi.stubGlobal("fetch", stubFetch(() => jsonResponse({ detail: "gateway hiccup" })));
    expect(await fetchColumnLogs("ws1", "Lane")).toEqual({
      workspace: "ws1",
      label: "Lane",
      events: [],
      wire: [],
      truncated: false,
    });
  });

  it("keeps well-formed payloads intact, including the truncated flag", async () => {
    const payload = {
      workspace: "ws1",
      label: "Lane",
      events: [{ type: "thought_delta" }],
      wire: [{ seq: 0, ts: 1, turn: 1, record: { kind: "llm_request" } }],
      truncated: true,
    };
    vi.stubGlobal("fetch", stubFetch(() => jsonResponse(payload)));
    expect(await fetchColumnLogs("ws1", "Lane")).toEqual(payload);
  });
});
