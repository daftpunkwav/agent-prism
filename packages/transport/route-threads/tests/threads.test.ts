/**
 * @file threads routes tests
 * @description Locks the thread surface: lifecycle CRUD, fork branching shape, SSE run, 409/422.
 *
 * Responsibilities:
 * - Pin the HTTP mapping: status codes for conflicts and validation failures
 * - Pin the SSE run stream shape and the server-side transcript commit
 */

import { describe, expect, it } from "vitest";
import { createHttpApplication, type HttpApplicationDeps } from "@agentprism/http-runtime";
import { registerThreadRoutes } from "../src/threads.js";
import { AppError, FileThreadStore, ThreadService, type ArenaService } from "@agentprism/application";
import type { ArenaEvent, ArenaRunRequest, PipelineConfig } from "@agentprism/contracts";
import { PipelineConfigSchema } from "@agentprism/contracts";
import { AtomicJsonFile } from "@agentprism/persistence";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const CONFIG: PipelineConfig = PipelineConfigSchema.parse({ label: "col" });

function scriptedArena(events: ArenaEvent[]): ArenaService {
  return {
    assertBaselineReplayable: () => undefined,
    run: async function* (request: ArenaRunRequest) {
      const label = typeof request.baseline?.label === "string" ? request.baseline.label : "";
      for (const event of events) {
        yield { ...event, pipeline: label, workspace: event.workspace === "" ? label : event.workspace };
      }
    },
  } as unknown as ArenaService;
}

function testDeps(arena: ArenaService): HttpApplicationDeps {
  const filePath = join(mkdtempSync(join(tmpdir(), "thread-routes-")), `${randomUUID()}.json`);
  const threads = new ThreadService({
    threads: new FileThreadStore({
      file: new AtomicJsonFile(filePath),
      idGenerator: { next: () => Math.random().toString(16).slice(2, 14).padEnd(12, "0") },
      clock: { now: () => 1700000000000 },
    }),
    arena,
    workspaceRegistry: { protectedCount: () => 0, clone: () => Promise.resolve(undefined), pin: () => undefined, unpin: () => undefined },
    clock: { now: () => 1700000000000 },
  });
  return {
    settings: {
      corsOrigins: "",
      frontendPort: 3000,
      apiToken: "",
      maxRequestSize: 1024 * 1024,
      backendHost: "127.0.0.1",
      backendPort: 8281,
      maxConcurrentRuns: 2,
    },
    arena: {},
    providers: {},
    workspaces: {},
    projects: {},
    builder: {},
    sessions: {},
    threads,
    clock: { now: () => 1700000000000 },
  } as unknown as HttpApplicationDeps;
}

function testApp(arena: ArenaService) {
  const deps = testDeps(arena);
  const app = createHttpApplication(deps);
  registerThreadRoutes(app, deps);
  return app;
}

async function createThread(app: ReturnType<typeof testApp>, title = "t"): Promise<{ id: string }> {
  const res = await app.request("/api/threads", {
    method: "POST",
    body: JSON.stringify({ title, config: {} }),
    headers: { "Content-Type": "application/json" },
  });
  return res.json() as Promise<{ id: string }>;
}

describe("thread routes", () => {
  it("creates with pipeline-default config and lists views", async () => {
    const app = testApp(scriptedArena([]));
    const created = await createThread(app, "my thread");
    expect(created.id).toBeTruthy();

    const list = await (await app.request("/api/threads")).json() as any;
    expect(list.threads).toHaveLength(1);
    expect(list.threads[0].title).toBe("my thread");
    expect(list.threads[0].config.toolset).toBe("full");
    expect(list.threads[0].running).toBe(false);
  });

  it("serves the detail with history and rejects unknown ids with 404", async () => {
    const app = testApp(scriptedArena([]));
    await expect(app.request("/api/threads/nope")).resolves.toMatchObject({ status: 404 });
    const { id } = await createThread(app);
    const detail = await (await app.request(`/api/threads/${id}`)).json() as any;
    expect(detail.thread.id).toBe(id);
    expect(detail.history).toEqual([]);
  });

  it("streams a run as thread SSE events and commits the turn server-side", async () => {
    const scripted: ArenaEvent[] = [
      { ...(baseEvent("thought")), content: "the answer" },
      { ...(baseEvent("complete")), metrics: { success: true } as ArenaEvent["metrics"] },
    ];
    const app = testApp(scriptedArena(scripted));
    const { id } = await createThread(app);

    const res = await app.request(`/api/threads/${id}/run`, {
      method: "POST",
      body: JSON.stringify({ question: "hello" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    // The thread stream owns its SSE channel name (not the arena one).
    expect(text).toContain("event: thread");
    expect(text).toContain(`"pipeline":"t-${id}"`);
    expect(text).toContain("the answer");

    const detail = await (await app.request(`/api/threads/${id}`)).json() as any;
    expect(detail.history.map((m: any) => m.content)).toEqual(["hello", "the answer"]);
  });

  it("maps a run on an already-running thread to 409 (not an in-stream error)", async () => {
    // Hold the first stream open until the second request arrives, mirroring a
    // genuinely concurrent second turn.
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const onStart = new Promise<void>((resolve) => {
      started = resolve;
    });
    const arena = {
      assertBaselineReplayable: () => undefined,
      run: async function* (request: ArenaRunRequest) {
        const label = typeof request.baseline?.label === "string" ? request.baseline.label : "";
        started();
        await gate;
        yield { ...(baseEvent("complete")), pipeline: label, metrics: { success: true } as ArenaEvent["metrics"] };
      },
    } as unknown as ArenaService;
    const app = testApp(arena);
    const { id } = await createThread(app);

    const first = app.request(`/api/threads/${id}/run`, { method: "POST", body: JSON.stringify({ question: "q" }), headers: { "Content-Type": "application/json" } });
    await onStart;
    const second = await app.request(`/api/threads/${id}/run`, { method: "POST", body: JSON.stringify({ question: "q" }), headers: { "Content-Type": "application/json" } });
    expect(second.status).toBe(409);

    release();
    const firstRes = await first;
    expect(firstRes.status).toBe(200);
    await firstRes.text();
  });

  it("validates the run body with 422", async () => {
    const app = testApp(scriptedArena([]));
    const { id } = await createThread(app);
    const res = await app.request(`/api/threads/${id}/run`, { method: "POST", body: JSON.stringify({ question: "" }), headers: { "Content-Type": "application/json" } });
    expect(res.status).toBe(422);
  });

  it("maps an unreplayable pinned config to 422 at creation", async () => {
    const arena = {
      assertBaselineReplayable: () => {
        throw AppError.unprocessable("Pinned config cannot be replayed: Baseline field \"endpoint_id\" has unsupported value");
      },
    } as unknown as ArenaService;
    const app = testApp(arena);

    const res = await app.request("/api/threads", {
      method: "POST",
      body: JSON.stringify({ title: "t", config: {} }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(422);
    const list = await (await app.request("/api/threads")).json() as { threads: unknown[] };
    expect(list.threads).toEqual([]);
  });

  it("forks with a branched workspace name and deletes", async () => {
    const app = testApp(scriptedArena([{ ...(baseEvent("complete")), metrics: { success: true } as ArenaEvent["metrics"] }]));
    const { id } = await createThread(app, "parent");
    // Consume the SSE body: dropping it leaves the turn's running flag to
    // background-drain timing, and the fork below would race it (409 flake).
    // The streaming test above consumes for the same reason.
    const runRes = await app.request(`/api/threads/${id}/run`, { method: "POST", body: JSON.stringify({ question: "q" }), headers: { "Content-Type": "application/json" } });
    expect(runRes.status).toBe(200);
    await runRes.text();

    const fork = await (await app.request(`/api/threads/${id}/fork`, { method: "POST", body: JSON.stringify({}), headers: { "Content-Type": "application/json" } })).json() as any;
    expect(fork.fork_of).toBe(id);
    expect(fork.workspace).toBe(`t-${fork.id}`);
    expect(fork.turn_count).toBe(1);

    const del = await app.request(`/api/threads/${fork.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
  });
});

function baseEvent(type: ArenaEvent["type"]): ArenaEvent {
  return {
    type,
    pipeline: "",
    workspace: "",
    content: "",
    tool: "",
    args: {},
    result: "",
    step: 0,
    passed: null,
    reason: "",
    metrics: null,
    message: "",
    token_stats: null,
    turn: 1,
    runId: "r1",
    timestamp: 0,
  } as ArenaEvent;
}
