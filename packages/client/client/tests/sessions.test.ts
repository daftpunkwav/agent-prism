/**
 * @file sessions tests
 * @description Covers the session ledger client: listing, detail, delete, errors.
 *
 * Responsibilities:
 * - Pin request paths/query mapping and ApiError classification
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, deleteSession, getSessionDetail, listSessions } from "@agentprism/client";

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return vi.fn((async (url: string | URL, init?: RequestInit) => handler(String(url), init)) as unknown as typeof fetch);
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sessions client", () => {
  it("lists with filters as query params and defaults to []", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      stubFetch((url) => {
        seen.push(url);
        return jsonResponse({ sessions: [{ id: "s1" }] });
      }),
    );
    expect(await listSessions({ kind: "arena", status: "active", limit: 10 })).toEqual([{ id: "s1" }]);
    expect(seen[0]).toContain("/api/sessions?");
    expect(seen[0]).toContain("kind=arena");
    expect(seen[0]).toContain("status=active");
    expect(seen[0]).toContain("limit=10");
    vi.stubGlobal("fetch", stubFetch(() => jsonResponse({})));
    expect(await listSessions()).toEqual([]);
  });

  it("fetches detail and deletes by encoded id", async () => {
    const seen: Array<{ url: string; method?: string }> = [];
    vi.stubGlobal(
      "fetch",
      stubFetch((url, init) => {
        seen.push({ url, method: init?.method });
        if (init?.method === "DELETE") return jsonResponse({ deleted: "a/b" });
        return jsonResponse({ record: { id: "a/b" }, entries: [] });
      }),
    );
    const detail = await getSessionDetail("a/b");
    expect(detail.record.id).toBe("a/b");
    await deleteSession("a/b");
    expect(seen.map((s) => s.url).every((u) => u.includes("a%2Fb"))).toBe(true);
    expect(seen[seen.length - 1]?.method).toBe("DELETE");
  });

  it("maps HTTP failures to ApiError", async () => {
    vi.stubGlobal("fetch", stubFetch(() => jsonResponse({ detail: "gone" }, 404)));
    const err = await getSessionDetail("missing").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
  });
});
