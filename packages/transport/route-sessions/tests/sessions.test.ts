/**
 * @file sessions routes tests
 * @description Locks the session read surface: filters, query pages, detail windows, telemetry, and 404s.
 */

import { describe, expect, it } from "vitest";
import { createHttpApplication } from "@agentprism/http-runtime";
import { registerSessionRoutes } from "../src/sessions.js";
import { SessionService } from "@agentprism/application";
import { InMemorySessionStore } from "@agentprism/session";

function testSettings(): unknown {
  return {
    corsOrigins: "",
    frontendPort: 3000,
    apiToken: "",
    maxRequestSize: 1024 * 1024,
    backendHost: "127.0.0.1",
    backendPort: 8281,
    maxConcurrentRuns: 2,
  };
}

async function testApp() {
  let seq = 0;
  const sessions = new SessionService({
    store: new InMemorySessionStore({ idGenerator: { next: () => `ses-${++seq}` }, clock: { now: () => 1700000000000 } }),
  });
  await sessions.startSession("arena", "first");
  const second = await sessions.startSession("agent", "second");
  await sessions.completeSession(second.id, "done");
  const third = await sessions.startSession("agent", "third");
  await sessions.cancelSession(third.id);
  const deps = {
    settings: testSettings(),
    arena: {},
    providers: {},
    workspaces: {},
    projects: {},
    builder: {},
    sessions,
    clock: { now: () => 1700000000000 },
  } as any;
  const app = createHttpApplication(deps);
  registerSessionRoutes(app, deps);
  return app;
}

describe("session routes", () => {
  it("lists newest-first and filters by kind/status", async () => {
    const app = await testApp();
    const all = await (await app.request("/api/sessions")).json() as any;
    expect(all.sessions.map((s: any) => s.title)).toEqual(["third", "second", "first"]);
    const arena = await (await app.request("/api/sessions?kind=arena")).json() as any;
    expect(arena.sessions).toHaveLength(1);
    const done = await (await app.request("/api/sessions?status=completed")).json() as any;
    expect(done.sessions).toHaveLength(1);
    const cancelled = await (await app.request("/api/sessions?status=cancelled")).json() as any;
    expect(cancelled.sessions).toHaveLength(1);
  });

  it("deletes records and 404s twice-deleted ids", async () => {
    const app = await testApp();
    const all = await (await app.request("/api/sessions")).json() as any;
    const id = all.sessions[0].id;
    const res = await app.request(`/api/sessions/${id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ deleted: id });
    expect((await app.request(`/api/sessions/${id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("rejects unknown filters and missing ids", async () => {
    const app = await testApp();
    expect((await app.request("/api/sessions?kind=nope")).status).toBe(400);
    expect((await app.request("/api/sessions/ses-missing")).status).toBe(404);
  });

  it("serves detail with entries", async () => {
    const app = await testApp();
    const all = await (await app.request("/api/sessions")).json() as any;
    const detail = await (await app.request(`/api/sessions/${all.sessions[0].id}`)).json() as any;
    expect(detail.record.title).toBe("third");
    expect(detail.record.status).toBe("cancelled");
    expect(detail.entries).toEqual([]);
    // Additive digest projection with the verdict rollup.
    expect(typeof detail.projection.digest).toBe("string");
    expect(detail.projection.verdicts).toMatchObject({ sessionId: all.sessions[0].id, passed: 0, failed: 0 });
  });

  it("serves bounded entry windows and rejects invalid ones", async () => {
    const app = await testApp();
    const all = await (await app.request("/api/sessions")).json() as any;
    const base = `/api/sessions/${all.sessions[0].id}`;
    const windowed = await (await app.request(`${base}?limit=1&offset=0`)).json() as any;
    expect(windowed.entries).toEqual([]);
    expect((await app.request(`${base}?limit=0`)).status).toBe(400);
    expect((await app.request(`${base}?offset=-1`)).status).toBe(400);
  });

  it("filters by multi-select kinds/statuses and entry text", async () => {
    const app = await testApp();
    const multi = await (await app.request("/api/sessions?kinds=arena,agent&statuses=completed,cancelled")).json() as any;
    expect(multi.total).toBe(2);
    // Single-select filters merge into (never dropped by) advanced queries.
    const merged = await (await app.request("/api/sessions?kind=arena&kinds=agent")).json() as any;
    expect(merged.total).toBe(3);
    const narrowed = await (await app.request("/api/sessions?kind=arena&statuses=completed")).json() as any;
    expect(narrowed.total).toBe(0);
    expect((await app.request("/api/sessions?kinds=nope")).status).toBe(400);
    expect((await app.request("/api/sessions?createdFrom=nope")).status).toBe(400);
    expect((await app.request("/api/sessions?kinds=" + "arena,".repeat(11))).status).toBe(400);
  });

  it("batch-exports selected sessions", async () => {
    const app = await testApp();
    const all = await (await app.request("/api/sessions")).json() as any;
    const ids = all.sessions.slice(0, 2).map((s: any) => s.id);
    const res = await app.request("/api/sessions/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.documents).toHaveLength(2);
    // Body shapes follow the house convention: schema mismatches are 422.
    expect((await app.request("/api/sessions/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [] }),
    })).status).toBe(422);
  });

  it("serves the session-query page with totals via q/sort/offset", async () => {
    const app = await testApp();
    const page = await (await app.request("/api/sessions?q=second&sort=newest&offset=0&limit=10")).json() as any;
    expect(page.sessions).toHaveLength(1);
    expect(page.sessions[0].title).toBe("second");
    expect(page.total).toBe(1);
    expect((await app.request("/api/sessions?sort=nope")).status).toBe(400);
    expect((await app.request("/api/sessions?offset=-2")).status).toBe(400);
  });

  it("serves the telemetry report", async () => {
    const app = await testApp();
    const res = await app.request("/api/sessions/telemetry");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("arena");
    expect(text).toContain("started=2");
  });
});

describe("session stats and export", () => {
  it("serves counts by kind and status", async () => {
    const app = await testApp();
    const res = await app.request("/api/sessions/stats");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      total: 3,
      byKind: { arena: 1, agent: 2, builder: 0 },
      byStatus: { active: 1, completed: 1, failed: 0, cancelled: 1 },
    });
  });

  it("exports a versioned envelope with a download header", async () => {
    const app = await testApp();
    const all = await (await app.request("/api/sessions")).json() as any;
    const res = await app.request(`/api/sessions/${all.sessions[0].id}/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment;");
    const envelope = await res.json() as any;
    expect(envelope.version).toBe(2);
    expect(typeof envelope.exportedAt).toBe("number");
    expect(envelope.record.title).toBe("third");
    expect(envelope.entries).toEqual([]);
  });

  it("404s stats-proof export for missing ids", async () => {
    const app = await testApp();
    expect((await app.request("/api/sessions/ses-missing/export")).status).toBe(404);
  });
});
