/**
 * @file thread routes tests
 * @description Locks the thread run stream's error fallbacks: in-stream faults ride
 * the thread-owned SSE channel, and a busy thread answers with a plain 409.
 *
 * The route surface (assertIdle/run) is doubled: transport tests pin the route's
 * status/stream behavior, not the ThreadService internals covered by their own tests.
 */

import { describe, expect, it, vi } from "vitest";
import { AppError } from "@agentprism/application";
import { buildTestApp, mockDeps } from "./mock-deps.js";
import type { HttpApplicationDeps } from "@agentprism/http-runtime";

type ThreadsDeps = HttpApplicationDeps["threads"];

/** Route-surface thread double; unknown turns fail loud through the mocked service. */
function threadDouble(overrides: Partial<ThreadsDeps> = {}): ThreadsDeps {
  return {
    list: vi.fn().mockReturnValue([]),
    create: vi.fn(),
    getDetail: vi.fn(),
    deleteThread: vi.fn(),
    fork: vi.fn(),
    assertIdle: vi.fn(),
    run: vi.fn(),
    ...overrides,
  } as unknown as ThreadsDeps;
}

describe("http-app thread run streaming", () => {
  it("surfaces in-stream run faults on the thread SSE channel", async () => {
    const run = vi.fn(() => (async function* () {
      throw new Error("thread boom");
    })());
    const app = buildTestApp({ threads: threadDouble({ run }) } as Partial<HttpApplicationDeps>);

    const res = await app.request("/api/threads/t1/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "resume this" }),
    });

    // A mid-stream fault must reach the client through the business-error
    // channel under `event: thread`, not as a bare stream close.
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("event: thread");
    expect(text).toContain('"type":"error"');
    expect(text).toContain('"pipeline":"system"');
    // The route drives the run with an abort signal so client disconnects propagate.
    expect(run).toHaveBeenCalledWith(
      "t1",
      { question: "resume this" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("answers a busy thread with 409 JSON instead of opening a stream", async () => {
    const assertIdle = vi.fn(() => {
      throw AppError.conflict('Thread "t1" already has a turn running');
    });
    const app = buildTestApp({ threads: threadDouble({ assertIdle }) } as Partial<HttpApplicationDeps>);

    const res = await app.request("/api/threads/t1/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "resume this" }),
    });

    // Conflict is checked before the stream opens: the client gets a retryable
    // status, never a 200 SSE that only fails once it is open.
    expect(res.status).toBe(409);
    expect(res.headers.get("content-type") ?? "").not.toContain("text/event-stream");
    expect(((await res.json()) as { detail: string }).detail).toContain("already has a turn running");
  });
});
