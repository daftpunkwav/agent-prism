/**
 * @file mount-routes tests
 * @description Lock domain route assembly for the server host.
 *
 * Responsibilities:
 * - Pin that every route leaf is mounted exactly once (a leaf silently
 *   dropped from mountDomainRoutes fails here, not in production)
 * - Pin the shell health probes and one representative endpoint per leaf
 *
 * The shell knows no domain routes; each route leaf mounts itself in
 * mountDomainRoutes.ts and nowhere else. These tests intentionally avoid
 * the real composition root — we hand-mount with stub services so a
 * regression in a route leaf does not require the full driver/langchain
 * chain to surface.
 */

import { describe, expect, it, vi } from "vitest";
import { FileThreadStore, SessionService, ThreadService } from "@agentprism/application";
import { InMemorySessionStore } from "@agentprism/session";
import { AtomicJsonFile } from "@agentprism/persistence";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { HttpApplicationDeps } from "@agentprism/http-runtime";
import { mountDomainRoutes } from "../src/mount-routes.js";

// ---------------------------------------------------------------------------
// Test fixture
// ---------------------------------------------------------------------------

/**
 * Builds an HttpApplicationDeps bundle with the minimum surface each route
 * leaf exercises. Real services are used only where the test would otherwise
 * short-circuit (sessions, threads); other services are stubbed with vi.fn().
 */
function stubDeps(): HttpApplicationDeps {
  return {
    settings: {
      corsOrigins: "",
      frontendPort: 3000,
      apiToken: "",
      maxRequestSize: 1024 * 1024,
      backendHost: "127.0.0.1",
      backendPort: 8281,
      maxConcurrentRuns: 2,
    } as any,
    arena: {
      getMeta: vi.fn().mockResolvedValue({ dimensions: [] }),
      pendingAsks: vi.fn().mockResolvedValue([]),
      judgeAsync: vi.fn().mockResolvedValue({ template_id: "t", template_name: "n", judge_type: "keyword", results: {} }),
    } as any,
    arenaLogs: {
      columnLogs: vi.fn().mockReturnValue({ workspace: "ws", label: "lane", events: [], wire: [], truncated: false }),
    } as any,
    matrix: { runMatrix: vi.fn() } as any,
    providers: { getProvider: vi.fn().mockReturnValue({}) } as any,
    workspaces: { listFiles: vi.fn().mockReturnValue([]) } as any,
    projects: { listProjects: vi.fn().mockReturnValue([]) } as any,
    builder: { catalog: vi.fn().mockReturnValue({}), pendingAsk: vi.fn().mockReturnValue([]) } as any,
    sessions: new SessionService({
      store: new InMemorySessionStore({
        idGenerator: { next: () => "ses-mount" },
        clock: { now: () => 1700000000000 },
      }),
    }),
    threads: new ThreadService({
      threads: new FileThreadStore({
        file: new AtomicJsonFile(join(tmpdir(), `thread-mount-${randomUUID()}.json`)),
        idGenerator: { next: () => "thr-mount" },
        clock: { now: () => 1700000000000 },
      }),
      arena: {} as any,
      workspaceRegistry: {
        protectedCount: () => 0,
        clone: () => Promise.resolve(undefined),
        pin: () => undefined,
        unpin: () => undefined,
      },
      clock: { now: () => 1700000000000 },
    }),
    clock: { now: () => 1700000000000 },
  };
}

// ---------------------------------------------------------------------------
// mountDomainRoutes
// ---------------------------------------------------------------------------

describe("mountDomainRoutes", () => {
  /**
   * Shell health probes must be reachable regardless of which route leaves
   * were mounted: the shell is the only piece that owns them.
   */
  it("serves shell health probes", async () => {
    const app = mountDomainRoutes(stubDeps());
    for (const path of ["/health", "/api/health"]) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
    }
  });

  /**
   * Matrix endpoint must validate its request body and reject malformed
   * input with 422 — proves the leaf's request schema is wired into the
   * route, not just stubbed out.
   */
  it("mounts the matrix endpoint with request validation", async () => {
    const app = mountDomainRoutes(stubDeps());
    const res = await app.request("/api/arena/matrix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cells: [] }),
    });
    expect(res.status).toBe(422);
  });

  /**
   * One endpoint per route leaf: a silent drop in mountDomainRoutes.ts
   * shows up here. If a leaf is missing, at least one of these requests
   * returns a non-200 status.
   */
  it("mounts one endpoint per route leaf", async () => {
    const app = mountDomainRoutes(stubDeps());
    const paths = [
      "/api/arena/meta",          // arena leaf
      "/api/builder/catalog",     // builder leaf
      "/api/arena/projects",      // projects leaf
      "/api/settings/provider",   // provider leaf
      "/api/arena/workspace/ws/files", // workspace leaf
      "/api/sessions",            // sessions leaf
      "/api/threads",             // threads leaf
    ];
    for (const path of paths) {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
    }
  });

  /**
   * Newer leaf endpoints added after the initial leaf set: each must be
   * reachable through the composed app (same drop-guard rationale as the
   * one-per-leaf list above, kept separate so the original list stays a
   * stable record of the first-generation surface).
   */
  it("mounts the pending-ask, judge-async, and batch-export endpoints", async () => {
    const app = mountDomainRoutes(stubDeps());

    const pending = await app.request("/api/arena/pending-asks");
    expect(pending.status).toBe(200);
    await expect(pending.json()).resolves.toEqual({ pending: [] });

    const judged = await app.request("/api/arena/judge-async", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_id: "t", answers: { col: "x" } }),
    });
    expect(judged.status).toBe(200);

    const exported = await app.request("/api/sessions/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["ses-missing"] }),
    });
    expect(exported.status).toBe(200);
    await expect(exported.json()).resolves.toEqual({ documents: [] });

    const builderPending = await app.request("/api/builder/sessions/s1/pending-ask");
    expect(builderPending.status).toBe(200);
    await expect(builderPending.json()).resolves.toEqual({ questions: [] });
  });

  it("mounts the column-logs endpoint and validates its query parameters", async () => {
    const app = mountDomainRoutes(stubDeps());

    const ok = await app.request("/api/arena/column-logs?workspace=ws&label=lane");
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toEqual({ workspace: "ws", label: "lane", events: [], wire: [], truncated: false });

    const missingLabel = await app.request("/api/arena/column-logs?workspace=ws");
    expect(missingLabel.status).toBe(400);

    const missingWorkspace = await app.request("/api/arena/column-logs?label=lane");
    expect(missingWorkspace.status).toBe(400);
  });

  /**
   * Unmounted path returns 404 from the shell — confirms the shell does
   * not pass through arbitrary routes (so a regression that widens the
   * shell's pass-through surface is caught).
   */
  it("returns 404 for routes that no leaf owns", async () => {
    const app = mountDomainRoutes(stubDeps());
    const res = await app.request("/api/this/leaf/does/not/exist");
    expect(res.status).toBe(404);
  });

  /**
   * The application object must expose a hono-compatible request adapter
   * (`app.request(...)`); the runtime relies on it in main.ts and in
   * the smoke boot test. A regression that drops the adapter would
   * surface here first.
   */
  it("returns an object with a callable request adapter", () => {
    const app = mountDomainRoutes(stubDeps());
    expect(typeof app.request).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

// mkdtempSync from node:fs is intentionally not imported: the FileThreadStore
// fixture above writes to a tmpdir()-rooted random file, which is sufficient
// for the assertions we make here.
