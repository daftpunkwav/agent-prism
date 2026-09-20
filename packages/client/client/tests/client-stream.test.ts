/**
 * @file client stream tests
 * @description Covers the SSE streaming entry points of the Arena API client.
 *
 * Responsibilities:
 * - Pin streamArenaRun request body assembly (optional fields dropped when empty)
 * - Lock event dispatch, parse-error reporting, [DONE] silence, and abort behavior
 * - Mirror the same contract for streamMatrixRun
 *
 * All responses are synthetic ReadableStream bodies; no server is started.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, streamArenaRun, streamMatrixRun } from "@agentprism/client";

function sseResponse(blocks: string[], status = 200): Response {
  const payload = blocks.map((b) => `data: ${b}\n\n`).join("");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { "Content-Type": "text/event-stream" } });
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return vi.fn((async (url: string | URL, init?: RequestInit) => handler(String(url), init)) as unknown as typeof fetch);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamArenaRun", () => {
  it("posts the run body (interactive always on) and dispatches parsed events", async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const events: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      stubFetch((url, init) => {
        seen.push({ url, init });
        return sseResponse(['{"type":"token"}', "[DONE]", '{"type":"done"}']);
      }),
    );
    await streamArenaRun({ question: "q", dimension: "framework", onEvent: (e) => events.push(e) });
    const init = seen[0]?.init;
    expect(seen[0]?.url).toContain("/api/arena/run");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ question: "q", dimension: "framework", selections: [], interactive: true });
    expect("baseline" in body).toBe(false); // empty optional fields are dropped
    expect("messages" in body).toBe(false);
    expect("column_sessions" in body).toBe(false);
    expect("attachments" in body).toBe(false);
    expect(events).toEqual([{ type: "token" }, { type: "done" }]); // [DONE] silent
  });

  it("includes optional fields only when non-empty", async () => {
    let body = "";
    vi.stubGlobal(
      "fetch",
      stubFetch((_url, init) => {
        body = String(init?.body);
        return sseResponse([]);
      }),
    );
    await streamArenaRun({
      question: "q",
      dimension: "framework",
      onEvent: () => {},
      selections: ["a"],
      baseline: { temperature: "0.7" } as never,
      messages: [{ role: "user", content: "hi" }],
      columnSessions: { laneA: { messages: [], workspace: "ws" } },
      attachments: [{ name: "a.txt", content: "x" }],
    });
    const parsed = JSON.parse(body) as Record<string, unknown>;
    expect(parsed.selections).toEqual(["a"]);
    expect(parsed.baseline).toEqual({ temperature: "0.7" });
    expect(parsed.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(parsed.column_sessions).toEqual({ laneA: { messages: [], workspace: "ws" } });
    expect(parsed.attachments).toEqual([{ name: "a.txt", content: "x" }]);
  });

  it("routes malformed data blocks to onParseError without killing the stream", async () => {
    const events: unknown[] = [];
    const parseErrors: string[] = [];
    vi.stubGlobal(
      "fetch",
      stubFetch(() => sseResponse(["not-json", '{"type":"done"}'])),
    );
    await streamArenaRun({
      question: "q",
      dimension: "framework",
      onEvent: (e) => events.push(e),
      onParseError: (raw) => parseErrors.push(raw),
    });
    expect(parseErrors).toEqual(["not-json"]);
    expect(events).toEqual([{ type: "done" }]);
  });

  it("ends silently when the request is aborted before connecting", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      stubFetch((_url, init) => {
        controller.abort(); // user abort surfaces as AbortError from fetch
        return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
      }),
    );
    await expect(
      streamArenaRun({
        question: "q",
        dimension: "framework",
        onEvent: () => {},
        signal: controller.signal,
      }),
    ).resolves.toBeUndefined();
  });

  it("throws ApiError with the body text on non-SSE failure responses", async () => {
    vi.stubGlobal("fetch", stubFetch(() => new Response("run exploded", { status: 502 })));
    const err = await streamArenaRun({ question: "q", dimension: "framework", onEvent: () => {} }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("run exploded");
    expect((err as ApiError).status).toBe(502);
  });

  it("surfaces non-abort network failures as network-kind ApiError", async () => {
    vi.stubGlobal("fetch", stubFetch(() => Promise.reject(new TypeError("fetch failed"))));
    const err = await streamArenaRun({ question: "q", dimension: "framework", onEvent: () => {} }).catch(
      (e: unknown) => e,
    );
    // apiFetch classifies connection failures; streamArenaRun rethrows them for the UI.
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe("network");
  });
});

describe("streamMatrixRun", () => {
  it("posts cells and dispatches progress plus report items", async () => {
    const seen: Array<{ url: string; body?: string }> = [];
    const items: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      stubFetch((url, init) => {
        seen.push({ url, body: String(init?.body) });
        return sseResponse(['{"type":"matrix_progress"}', '{"type":"matrix_report"}']);
      }),
    );
    await streamMatrixRun({
      cells: [{ template_id: "cot", dimension: "framework" }],
      onItem: (i) => items.push(i),
    });
    expect(seen[0]?.url).toContain("/api/arena/matrix");
    expect(JSON.parse(seen[0]?.body ?? "{}")).toEqual({ cells: [{ template_id: "cot", dimension: "framework" }] });
    expect(items).toEqual([{ type: "matrix_progress" }, { type: "matrix_report" }]);
  });

  it("routes parse failures to onParseError and maps HTTP failures to ApiError", async () => {
    const parseErrors: string[] = [];
    vi.stubGlobal("fetch", stubFetch(() => sseResponse(["{oops"])));
    await streamMatrixRun({ cells: [], onItem: () => {}, onParseError: (raw) => parseErrors.push(raw) });
    expect(parseErrors).toEqual(["{oops"]);
    vi.stubGlobal("fetch", stubFetch(() => new Response("matrix failed", { status: 500 })));
    const err = await streamMatrixRun({ cells: [], onItem: () => {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("matrix failed");
  });

  it("ends silently on a pre-connect user abort", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      stubFetch((_url, init) => {
        controller.abort();
        return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
      }),
    );
    await expect(
      streamMatrixRun({ cells: [], onItem: () => {}, signal: controller.signal }),
    ).resolves.toBeUndefined();
  });
});
