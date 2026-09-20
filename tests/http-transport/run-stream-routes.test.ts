/**
 * @file run-stream-routes tests
 * @description Locks the run stream: SSE delivery, in-stream errors, request validation.
 */

import { describe, expect, it, vi } from "vitest";
import { buildTestApp, mockDeps } from "./mock-deps.js";

describe("http-app arena run streaming", () => {
  it("POST /api/arena/run streams events as SSE", async () => {
    const deps = mockDeps();
    async function* fakeRun() {
      yield { type: "token_update", pipeline: "col-a", workspace: "w", content: "", tool: "", args: {}, result: "", step: 1, passed: null, reason: "", metrics: null, token_stats: { input_tokens: 1, output_tokens: 1, total_tokens: 2, context_window: 1, max_input_tokens: 1, max_output_tokens: 1, context_usage_pct: 0, input_usage_pct: 0 }, turn: 1, agentId: "a", runId: "r", timestamp: 0 };
      yield { type: "complete", pipeline: "col-a", workspace: "w", content: "", tool: "", args: {}, result: "", step: 1, passed: null, reason: "", metrics: null, turn: 1, agentId: "a", runId: "r", timestamp: 0 };
    }
    (deps.arena as any).run = vi.fn().mockImplementation(() => fakeRun());
    const app = buildTestApp(deps);
    const res = await app.request("/api/arena/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "test question" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("token_update");
    expect(text).toContain("complete");
    expect(deps.arena.run).toHaveBeenCalledWith(
      expect.objectContaining({ question: "test question" }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("POST /api/arena/run surfaces in-stream errors as SSE error events", async () => {
    const deps = mockDeps();
    (deps.arena as any).run = vi.fn().mockImplementation(() =>
      (async function* () {
        yield { type: "token_update", pipeline: "col-a", workspace: "w", content: "", tool: "", args: {}, result: "", step: 1, passed: null, reason: "", metrics: null, turn: 1, agentId: "a", runId: "r", timestamp: 0 };
        throw new Error("boom");
      })(),
    );
    const app = buildTestApp(deps);
    const res = await app.request("/api/arena/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "test question" }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    // Client must receive a system-level error event, not only a closed stream
    expect(text).toContain('"pipeline":"system"');
    expect(text).toContain('"type":"error"');
  });

  it("POST /api/arena/run returns 422 when question is missing", async () => {
    const app = buildTestApp(mockDeps());
    const res = await app.request("/api/arena/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });

});
