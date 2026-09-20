/**
 * @file threads client tests
 * @description Covers the durable-thread API client: lifecycle CRUD and resume streaming.
 *
 * Responsibilities:
 * - Pin request method/path/body mapping for thread create/list/detail/fork/delete
 * - Lock streamThreadRun event dispatch, [DONE] silence, and abort behavior
 *
 * All requests run against a stubbed global fetch; no server is started.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createThread,
  deleteThread,
  forkThread,
  getThread,
  listThreads,
  streamThreadRun,
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

describe("threads client REST surface", () => {
  it("lists threads and defaults a missing payload to []", async () => {
    vi.stubGlobal("fetch", stubFetch((url) => {
      expect(url).toContain("/api/threads");
      return jsonResponse({ threads: [{ id: "t1" }] });
    }));
    expect(await listThreads()).toEqual([{ id: "t1" }]);
    vi.stubGlobal("fetch", stubFetch(() => jsonResponse({})));
    expect(await listThreads()).toEqual([]);
  });

  it("creates a thread with the pinned config as body", async () => {
    const seen: Array<{ method?: string; body?: string }> = [];
    vi.stubGlobal(
      "fetch",
      stubFetch((_url, init) => {
        seen.push({ method: init?.method, body: String(init?.body) });
        return jsonResponse({ id: "t1" });
      }),
    );
    expect(await createThread({ question: "q", pipeline: "cot" } as never)).toEqual({ id: "t1" });
    expect(seen[0]?.method).toBe("POST");
    expect(JSON.parse(seen[0]?.body ?? "{}")).toEqual({ question: "q", pipeline: "cot" });
  });

  it("gets detail and forks by encoded id; the parent stays untouched on fork", async () => {
    const seen: Array<{ url: string; method?: string; body?: string }> = [];
    vi.stubGlobal(
      "fetch",
      stubFetch((url, init) => {
        seen.push({ url, method: init?.method, body: String(init?.body) });
        if (init?.method === "POST") return jsonResponse({ id: "t2" });
        return jsonResponse({ thread: { id: "a/b" }, transcript: [] });
      }),
    );
    expect(await getThread("a/b")).toEqual({ thread: { id: "a/b" }, transcript: [] });
    expect(await forkThread("a/b", { label: "branch" } as never)).toEqual({ id: "t2" });
    expect(seen.every((s) => s.url.includes("a%2Fb"))).toBe(true);
    expect(seen[1]?.url).toContain("/fork");
    expect(JSON.parse(seen[1]?.body ?? "{}")).toEqual({ label: "branch" });
  });

  it("forks with the default empty request body when no options are given", async () => {
    let body = "";
    vi.stubGlobal(
      "fetch",
      stubFetch((_url, init) => {
        body = String(init?.body);
        return jsonResponse({ id: "t2" });
      }),
    );
    await forkThread("t1");
    expect(JSON.parse(body)).toEqual({});
  });

  it("deletes a thread with DELETE", async () => {
    const seen: Array<{ method?: string }> = [];
    vi.stubGlobal(
      "fetch",
      stubFetch((_url, init) => {
        seen.push({ method: init?.method });
        return jsonResponse({ deleted: "t1" });
      }),
    );
    await deleteThread("t1");
    expect(seen[0]?.method).toBe("DELETE");
  });

  it("maps HTTP failures to ApiError with server detail", async () => {
    vi.stubGlobal("fetch", stubFetch(() => jsonResponse({ detail: "running" }, 409)));
    const err = await deleteThread("t1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("running");
    expect((err as ApiError).status).toBe(409);
  });
});

describe("streamThreadRun", () => {
  it("streams one resume turn through the thread-owned SSE channel", async () => {
    const seen: Array<{ url?: string; body?: string }> = [];
    const events: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      stubFetch((url, init) => {
        seen.push({ url, body: String(init?.body) });
        return sseResponse(['{"type":"token"}', "[DONE]", '{"type":"done"}']);
      }),
    );
    await streamThreadRun({ threadId: "t/1", question: "next", onEvent: (e) => events.push(e) });
    expect(seen[0]?.url).toContain(`/api/threads/${encodeURIComponent("t/1")}/run`);
    expect(JSON.parse(seen[0]?.body ?? "{}")).toEqual({ question: "next" });
    expect(events).toEqual([{ type: "token" }, { type: "done" }]);
  });

  it("routes malformed blocks to onParseError", async () => {
    const parseErrors: string[] = [];
    vi.stubGlobal("fetch", stubFetch(() => sseResponse(["}bad{"])));
    await streamThreadRun({
      threadId: "t1",
      question: "q",
      onEvent: () => {},
      onParseError: (raw) => parseErrors.push(raw),
    });
    expect(parseErrors).toEqual(["}bad{"]);
  });

  it("throws ApiError on failure and stays silent on user abort", async () => {
    vi.stubGlobal("fetch", stubFetch(() => new Response("thread run failed", { status: 503 })));
    const err = await streamThreadRun({ threadId: "t1", question: "q", onEvent: () => {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(503);

    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      stubFetch((_url, init) => {
        controller.abort();
        return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
      }),
    );
    await expect(
      streamThreadRun({ threadId: "t1", question: "q", onEvent: () => {}, signal: controller.signal }),
    ).resolves.toBeUndefined();
  });
});
