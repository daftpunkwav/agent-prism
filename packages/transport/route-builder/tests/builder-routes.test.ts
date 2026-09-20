/**
 * @file builder routes tests
 * @description Locks the Agent Builder HTTP surface: catalog, sessions, hot-swap, abort.
 *
 * Responsibilities:
 * - Pin request/response forwarding for each builder endpoint
 * - Pin 422 mapping for schema-invalid hot-swap payloads
 * - Pin schema defaults on session creation (empty object still creates)
 *
 * The root http-transport tests pin generic route/error plumbing; these cases
 * pin the builder domain surface the package owns.
 */

import { describe, expect, it, vi } from "vitest";
import type { Settings } from "@agentprism/config";
import { createHttpApplication, type HttpApp, type HttpApplicationDeps } from "@agentprism/http-runtime";
import { registerBuilderRoutes } from "../src/builder.js";

/** Composed builder test app: shell + builder routes only. */
function buildBuilderTestApp(deps: HttpApplicationDeps): HttpApp {
  const app = createHttpApplication(deps);
  registerBuilderRoutes(app, deps);
  return app;
}

function testSettings(): Settings {
  // Partial stub: only the fields the shell middleware reads; the cast mirrors
  // the composed-settings stubs in apps/server/tests.
  return {
    llmProviderName: "test",
    llmApiKey: "",
    llmBaseUrl: "",
    llmModel: "test-model",
    llmApiFormat: "anthropic_messages",
    llmTemperature: 0,
    backendHost: "127.0.0.1",
    frontendPort: 3000,
    backendPort: 8281,
    corsOrigins: "",
    maxRequestSize: 1024 * 1024,
    apiToken: "",
    maxConcurrentRuns: 2,
    llmTimeoutMs: 120_000,
    llmMaxRetries: 2,
    breakerThreshold: 3,
    breakerCooldownMs: 30_000,
    askUserWaitMs: 300_000,
    maxConcurrentColumns: 8,
    maxWorkspaces: 32,
    workspaceTtlSeconds: 3600,
  } as Settings;
}

/** Minimal mock deps: every non-builder service is inert; builder calls are observed. */
function mockDeps(): HttpApplicationDeps {
  return {
    settings: testSettings(),
    arena: {} as any,
    arenaLogs: { columnLogs: vi.fn().mockReturnValue({ events: [], wire: [] }) } as any,
    matrix: {} as any,
    providers: {} as any,
    workspaces: {} as any,
    projects: {} as any,
    builder: {
      catalog: vi.fn().mockReturnValue({ frameworks: [] }),
      createSession: vi.fn().mockReturnValue({ id: "s1" }),
      listSessions: vi.fn().mockReturnValue([{ id: "s1" }]),
      getSessionDetail: vi.fn().mockResolvedValue({ session: { id: "s1" }, records: [] }),
      patchComposition: vi.fn().mockReturnValue({ changed_fields: [] }),
      deleteSession: vi.fn(),
      abortTurn: vi.fn().mockReturnValue(true),
      pendingAsk: vi.fn().mockReturnValue([]),
      chatTurn: vi.fn(),
    } as any,
    sessions: { listSessions: async () => [], getSession: async () => null } as any,
    threads: { list: () => [], getDetail: () => ({ thread: {}, history: [] }), create: () => ({}), fork: () => ({}), deleteThread: () => ({}), run: () => ({}), assertIdle: () => undefined } as any,
    clock: { now: () => 1700000000000 },
  };
}

describe("builder routes", () => {
  it("GET /api/builder/catalog forwards the catalog", async () => {
    const deps = mockDeps();
    const res = await buildBuilderTestApp(deps).request("/api/builder/catalog");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ frameworks: [] });
    expect(deps.builder.catalog).toHaveBeenCalledOnce();
  });

  it("GET /api/builder/sessions wraps the session list", async () => {
    const deps = mockDeps();
    const res = await buildBuilderTestApp(deps).request("/api/builder/sessions");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ sessions: [{ id: "s1" }] });
  });

  it("GET /api/builder/sessions/:id forwards the session id and awaits the journal read", async () => {
    const deps = mockDeps();
    const res = await buildBuilderTestApp(deps).request("/api/builder/sessions/s1");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ session: { id: "s1" }, records: [] });
    expect(deps.builder.getSessionDetail).toHaveBeenCalledWith("s1");
  });

  it("POST /api/builder/sessions applies schema defaults", async () => {
    const deps = mockDeps();
    const res = await buildBuilderTestApp(deps).request("/api/builder/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(deps.builder.createSession).toHaveBeenCalledWith({ name: "", composition: {} });
  });

  it("PATCH /api/builder/sessions/:id accepts an empty body (rename/no-op) and 422s on bad types", async () => {
    const app = buildBuilderTestApp(mockDeps());
    // An empty patch is legal: it renames nothing and swaps nothing.
    const ok = await app.request("/api/builder/sessions/s1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(ok.status).toBe(200);
    // Malformed field types still fail the schema.
    const bad = await app.request("/api/builder/sessions/s1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: 42 }),
    });
    expect(bad.status).toBe(422);
  });

  it("DELETE /api/builder/sessions/:id deletes and returns ok", async () => {
    const deps = mockDeps();
    const res = await buildBuilderTestApp(deps).request("/api/builder/sessions/s1", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(deps.builder.deleteSession).toHaveBeenCalledWith("s1");
  });

  it("POST /api/builder/sessions/:id/abort returns the abort flag", async () => {
    const deps = mockDeps();
    const res = await buildBuilderTestApp(deps).request("/api/builder/sessions/s1/abort", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, aborted: true });
    expect(deps.builder.abortTurn).toHaveBeenCalledWith("s1");
  });

  it("GET /api/builder/sessions/:id/pending-ask forwards the session id", async () => {
    const deps = mockDeps();
    vi.mocked(deps.builder.pendingAsk).mockReturnValue([{ id: "q1", header: "h", question: "q?", options: ["a"] }]);
    const res = await buildBuilderTestApp(deps).request("/api/builder/sessions/s1/pending-ask");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      questions: [{ id: "q1", header: "h", question: "q?", options: ["a"] }],
    });
    expect(deps.builder.pendingAsk).toHaveBeenCalledWith("s1");
  });
});
