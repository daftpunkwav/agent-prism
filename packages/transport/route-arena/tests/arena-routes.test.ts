/**
 * @file arena routes tests
 * @description Locks the arena route surface: meta, human channel, column logs, judging, and SSE streams.
 */

import { describe, expect, it, vi } from "vitest";
import { createHttpApplication, type HttpApplicationDeps } from "@agentprism/http-runtime";
import { registerArenaRoutes } from "../src/arena.js";

function testDeps() {
  const deps = {
    settings: {
      corsOrigins: "",
      frontendPort: 3000,
      apiToken: "",
      maxRequestSize: 1024 * 1024,
      backendHost: "127.0.0.1",
      backendPort: 8281,
      maxConcurrentRuns: 2,
      sseHeartbeatMs: 60_000,
    },
    clock: { now: () => 1_700_000_000_000 },
    arena: {
      getMeta: vi.fn(async () => ({ dimensions: [{ id: "framework" }] })),
      answerQuestion: vi.fn(async () => undefined),
      pendingAsks: vi.fn(async () => [{ agentId: "a1", questions: [] }]),
      stopColumn: vi.fn(async () => undefined),
      listTemplates: vi.fn(() => [{ id: "t1", question: "q", suggested_dimension: null, suggested_selections: [], category: "open" }]),
      judge: vi.fn(() => ({ results: {} })),
      judgeAsync: vi.fn(async () => ({ results: {} })),
      run: async function* () {
        yield { type: "complete", pipeline: "col-a", turn: 1 };
      },
    },
    arenaLogs: {
      columnLogs: vi.fn(() => ({ wire: [], events: [], truncated: false })),
    },
    matrix: {
      runMatrix: async function* () {
        yield { kind: "progress", template_id: "t1", status: "running" };
        yield { kind: "report", report: { cells: [] } };
      },
    },
  } as unknown as HttpApplicationDeps;
  const app = createHttpApplication(deps);
  registerArenaRoutes(app, deps);
  return { app, deps };
}

describe("arena routes", () => {
  it("serves meta, pending asks, and templates", async () => {
    const { app, deps } = testDeps();
    expect((await (await app.request("/api/arena/meta")).json()).dimensions).toHaveLength(1);
    expect((await (await app.request("/api/arena/pending-asks")).json()).pending).toHaveLength(1);
    expect((await (await app.request("/api/arena/templates")).json()).templates).toHaveLength(1);
    expect(deps.arena.listTemplates).toHaveBeenCalledOnce();
  });

  it("maps the human channel: answer and per-column stop", async () => {
    const { app, deps } = testDeps();
    const answer = await app.request("/api/arena/answer", {
      method: "POST",
      body: JSON.stringify({ agent_id: "a1", question_id: "q1", answer: "yes" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(await answer.json()).toEqual({ ok: true });
    expect(deps.arena.answerQuestion).toHaveBeenCalledWith("a1", "q1", "yes");

    const stop = await app.request("/api/arena/stop-column", {
      method: "POST",
      body: JSON.stringify({ agent_id: "a1" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(await stop.json()).toEqual({ ok: true });
    expect(deps.arena.stopColumn).toHaveBeenCalledWith("a1");
  });

  it("requires workspace and label for column logs", async () => {
    const { app, deps } = testDeps();
    const bad = await app.request("/api/arena/column-logs");
    expect(bad.status).toBe(400);

    const ok = await app.request("/api/arena/column-logs?workspace=ws-a&label=Native");
    expect(ok.status).toBe(200);
    expect(deps.arenaLogs.columnLogs).toHaveBeenCalledWith("ws-a", "Native");
  });

  it("serves sync and async judging", async () => {
    const { app, deps } = testDeps();
    const body = { template_id: "t1", answers: { Native: "answer" } };
    const sync = await app.request("/api/arena/judge", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
    expect(sync.status).toBe(200);
    expect(deps.arena.judge).toHaveBeenCalledWith("t1", { Native: "answer" });

    const async = await app.request("/api/arena/judge-async", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
    expect(async.status).toBe(200);
    expect(deps.arena.judgeAsync).toHaveBeenCalledOnce();
  });

  it("streams the run as SSE arena events", async () => {
    const { app } = testDeps();
    const res = await app.request("/api/arena/run", {
      method: "POST",
      body: JSON.stringify({ question: "q", dimension: "framework", selections: ["native"], messages: [] }),
      headers: { "Content-Type": "application/json" },
    });
    const text = await res.text();
    expect(text).toContain("event: arena");
    expect(text).toContain('"pipeline":"col-a"');
  });

  it("streams matrix progress and the terminal report", async () => {
    const { app } = testDeps();
    const res = await app.request("/api/arena/matrix", {
      method: "POST",
      body: JSON.stringify({ cells: [{ template_id: "t1" }] }),
      headers: { "Content-Type": "application/json" },
    });
    const text = await res.text();
    expect(text).toContain('"type":"matrix_progress"');
    expect(text).toContain('"type":"matrix_report"');
  });
});
