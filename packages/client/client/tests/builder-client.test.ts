/**
 * @file builder client tests
 * @description Covers the builder API client: session CRUD, hot-swap, abort, and chat streaming.
 *
 * Responsibilities:
 * - Pin request method/path/body mapping for every builder route
 * - Lock streamBuilderChat chunk dispatch, [DONE] silence, and parse-error routing
 *
 * All requests run against a stubbed global fetch; no server is started.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  abortBuilderTurn,
  answerBuilderQuestion,
  ApiError,
  createBuilderSession,
  deleteBuilderSession,
  fetchBuilderCatalog,
  fetchBuilderSessionDetail,
  fetchBuilderSessions,
  patchBuilderComposition,
  streamBuilderChat,
} from "@agentprism/client";

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return vi.fn((async (url: string | URL, init?: RequestInit) => handler(String(url), init)) as unknown as typeof fetch);
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function sseResponse(blocks: string[]): Response {
  const payload = blocks.map((b) => `data: ${b}\n\n`).join("");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("builder client REST surface", () => {
  it("loads catalog and session list from their GET paths", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      stubFetch((url) => {
        seen.push(url);
        if (url.endsWith("/api/builder/catalog")) return jsonResponse({ frameworks: [] });
        return jsonResponse({ sessions: [{ id: "b1" }] });
      }),
    );
    expect(await fetchBuilderCatalog()).toEqual({ frameworks: [] });
    expect(await fetchBuilderSessions()).toEqual([{ id: "b1" }]);
    expect(seen).toEqual(["/api/builder/catalog", "/api/builder/sessions"]);
  });

  it("creates, reads, patches and deletes sessions with encoded ids", async () => {
    const seen: Array<{ url: string; method?: string; body?: string }> = [];
    vi.stubGlobal(
      "fetch",
      stubFetch((url, init) => {
        seen.push({ url, method: init?.method, body: typeof init?.body === "string" ? init.body : undefined });
        if (init?.method === "PATCH") return jsonResponse({ swapped: ["laneA"] });
        if (init?.method === "POST") return jsonResponse({ id: "a/b" });
        return jsonResponse({ session: { id: "a/b" } });
      }),
    );
    await createBuilderSession({ question: "q" } as never);
    expect(await fetchBuilderSessionDetail("a/b")).toEqual({ session: { id: "a/b" } });
    expect(await patchBuilderComposition("a/b", {} as Parameters<typeof patchBuilderComposition>[1])).toEqual({
      swapped: ["laneA"],
    });
    await deleteBuilderSession("a/b");
    // The create POST targets the collection path; every id-bearing call encodes the id.
    expect(seen.slice(1).every((s) => s.url.includes("a%2Fb"))).toBe(true);
    expect(seen[0]?.method).toBe("POST");
    expect(seen[2]?.method).toBe("PATCH");
    expect(seen[3]?.method).toBe("DELETE");
  });

  it("aborts the in-flight turn and reports whether one was running", async () => {
    const seen: Array<{ method?: string }> = [];
    vi.stubGlobal(
      "fetch",
      stubFetch((_url, init) => {
        seen.push({ method: init?.method });
        return jsonResponse({ aborted: true });
      }),
    );
    expect(await abortBuilderTurn("b1")).toBe(true);
    expect(seen[0]?.method).toBe("POST");
  });

  it("delivers ask_user answers to the session", async () => {
    const seen: Array<{ url?: string; body?: string }> = [];
    vi.stubGlobal(
      "fetch",
      stubFetch((url, init) => {
        seen.push({ url, body: String(init?.body) });
        return jsonResponse({ delivered: true });
      }),
    );
    await answerBuilderQuestion("b1", "q1", "42");
    expect(seen[0]?.url).toContain("/api/builder/sessions/b1/answer");
    expect(JSON.parse(seen[0]?.body ?? "{}")).toEqual({ question_id: "q1", answer: "42" });
  });

  it("maps HTTP failures to ApiError with server detail", async () => {
    vi.stubGlobal("fetch", stubFetch(() => jsonResponse({ detail: "locked" }, 409)));
    const err = await deleteBuilderSession("b1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("locked");
    expect((err as ApiError).status).toBe(409);
  });
});

describe("streamBuilderChat", () => {
  it("posts the message and dispatches chunks; [DONE] stays silent", async () => {
    const seen: Array<{ url?: string; body?: string; accept?: string }> = [];
    const chunks: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      stubFetch((url, init) => {
        seen.push({ url, body: String(init?.body), accept: String(new Headers(init?.headers).get("Accept")) });
        return sseResponse(['{"kind":"trace"}', "[DONE]", '{"kind":"turn_meta"}']);
      }),
    );
    await streamBuilderChat({ sessionId: "s 1", message: "go", onChunk: (c) => chunks.push(c) });
    expect(seen[0]?.url).toContain(`/api/builder/sessions/${encodeURIComponent("s 1")}/chat`);
    expect(seen[0]?.accept).toBe("text/event-stream");
    expect(JSON.parse(seen[0]?.body ?? "{}")).toEqual({ message: "go" });
    expect(chunks).toEqual([{ kind: "trace" }, { kind: "turn_meta" }]);
  });

  it("includes attachments only when provided", async () => {
    let body = "";
    vi.stubGlobal(
      "fetch",
      stubFetch((_url, init) => {
        body = String(init?.body);
        return sseResponse([]);
      }),
    );
    await streamBuilderChat({ sessionId: "s1", message: "m", onChunk: () => {} });
    expect(JSON.parse(body)).toEqual({ message: "m" });
    await streamBuilderChat({
      sessionId: "s1",
      message: "m",
      attachments: [{ name: "n.txt", content: "c" }],
      onChunk: () => {},
    });
    expect(JSON.parse(body)).toEqual({ message: "m", attachments: [{ name: "n.txt", content: "c" }] });
  });

  it("routes malformed chunks to onParseError and ends silently on user abort", async () => {
    const parseErrors: string[] = [];
    const chunks: unknown[] = [];
    vi.stubGlobal("fetch", stubFetch(() => sseResponse(["{bad", '{"kind":"done"}'])));
    await streamBuilderChat({
      sessionId: "s1",
      message: "m",
      onChunk: (c) => chunks.push(c),
      onParseError: (raw) => parseErrors.push(raw),
    });
    expect(parseErrors).toEqual(["{bad"]);
    expect(chunks).toEqual([{ kind: "done" }]);

    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      stubFetch((_url, init) => {
        controller.abort();
        return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
      }),
    );
    await expect(
      streamBuilderChat({ sessionId: "s1", message: "m", onChunk: () => {}, signal: controller.signal }),
    ).resolves.toBeUndefined();
  });

  it("throws ApiError with the response text on failure", async () => {
    vi.stubGlobal("fetch", stubFetch(() => new Response("chat exploded", { status: 500 })));
    const err = await streamBuilderChat({ sessionId: "s1", message: "m", onChunk: () => {} }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("chat exploded");
  });
});
