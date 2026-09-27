/**
 * @file assemble tests
 * @description Composition-root behavior for apps/server.
 *
 * Responsibilities:
 * - Pin the happy-path boot (wires components, serves /health, /api/sessions,
 *   /api/arena/meta)
 * - Pin every fail-fast branch (host/token refusal, capability seam emptiness,
 *   malformed MCP env, provider-cache invalidation failure, initial sync
 *   failure)
 *
 * The single file groups two describe blocks because both target one src
 * file (assemble.ts). Driver import pulls the langchain chain; the 120s budget
 * mirrors the prior smoke test.
 *
 * Env scrub policy: BACKEND_HOST, API_TOKEN, MCP_SERVERS are scrubbed in
 * beforeEach and restored in afterEach so one case cannot leak into another.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DimensionRouter } from "@agentprism/arena-dimensions";

// ---------------------------------------------------------------------------
// Env scrub helpers
// ---------------------------------------------------------------------------

const SCRUBBED = ["BACKEND_HOST", "API_TOKEN", "MCP_SERVERS"] as const;
const saved: Record<string, string | undefined> = {};

function scrubEnv(): void {
  for (const key of SCRUBBED) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
}

function restoreEnv(): void {
  for (const key of SCRUBBED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

beforeEach(scrubEnv);
afterEach(() => {
  vi.restoreAllMocks();
  restoreEnv();
});

// Driver import pulls the langchain chain; mirrors the prior smoke test budget.
const COMPOSITION_TIMEOUT = 120_000;

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("assemble() happy path", () => {
  it("boots and serves health, sessions, and arena meta", { timeout: COMPOSITION_TIMEOUT }, async () => {
    const { assemble } = await import("../src/assemble.js");

    const { app } = await assemble();

    const health = await app.request("/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok", service: "arena" });

    const sessions = await app.request("/api/sessions");
    expect(sessions.status).toBe(200);
    expect(Array.isArray((await sessions.json() as any).sessions)).toBe(true);

    const meta = await app.request("/api/arena/meta");
    expect(meta.status).toBe(200);
    const body = (await meta.json()) as any;
    expect(Array.isArray(body.dimensions)).toBe(true);
    expect(body.dimensions.length).toBeGreaterThan(0);
  });

  it(
    "wires the builder endpoints and the column-log reads",
    { timeout: COMPOSITION_TIMEOUT },
    async () => {
      const { assemble } = await import("../src/assemble.js");
      const { app } = await assemble();

      // Builder endpoints: a lazy factory the boot smoke test never reached. A missing
      // block would leave the builder composer without a model to run.
      const catalog = await app.request("/api/builder/catalog");
      expect(catalog.status).toBe(200);
      const catalogBody = (await catalog.json()) as any;
      expect(Array.isArray(catalogBody.endpoints)).toBe(true);

      // Column logs: the read side of the per-run trace files, with its query
      // validation and its "unknown workspace yields empty, never 404" contract.
      const missingParams = await app.request("/api/arena/column-logs");
      expect(missingParams.status).toBe(400);
      const unknownWorkspace = await app.request("/api/arena/column-logs?workspace=ws-missing&label=Native");
      expect(unknownWorkspace.status).toBe(200);
      const logsBody = (await unknownWorkspace.json()) as any;
      expect(logsBody).toMatchObject({ workspace: "ws-missing", label: "Native", events: [], wire: [] });
    },
  );
});

// ---------------------------------------------------------------------------
// Fail-fast branches
// ---------------------------------------------------------------------------

describe("assemble() fail-fast branches", () => {
  it("refuses to start on a non-loopback host without API_TOKEN", { timeout: COMPOSITION_TIMEOUT }, async () => {
    process.env["BACKEND_HOST"] = "0.0.0.0";
    // API_TOKEN intentionally absent.
    const { assemble } = await import("../src/assemble.js");
    await expect(assemble()).rejects.toThrow(/API_TOKEN is required/);
  });

  it("accepts loopback without API_TOKEN (warns, does not throw)", { timeout: COMPOSITION_TIMEOUT }, async () => {
    process.env["BACKEND_HOST"] = "127.0.0.1";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { assemble } = await import("../src/assemble.js");
    const components = await assemble();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("API_TOKEN is empty"));
    // flushDurableStores is part of the public contract; calling it confirms the bundle is real.
    await components.flushDurableStores();
  });

  it("refuses to start when a required capability seam has zero options", { timeout: COMPOSITION_TIMEOUT }, async () => {
    // Force every capability dim to stay empty: drop the router's sync call so
    // the catalog never receives any capability option.
    vi.spyOn(DimensionRouter.prototype, "syncCapabilityOptions").mockImplementation(() => undefined);

    const { assemble } = await import("../src/assemble.js");
    await expect(assemble()).rejects.toThrow(/zero implementations/);
  });

  it("warns (does not throw) when MCP_SERVERS env is malformed", { timeout: COMPOSITION_TIMEOUT }, async () => {
    process.env["MCP_SERVERS"] = ":::not json:::";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { assemble } = await import("../src/assemble.js");
    const components = await assemble();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("MCP_SERVERS ignored"));
    await components.flushDurableStores();
  });

  it("warns when the provider change listener's cache invalidation throws", { timeout: COMPOSITION_TIMEOUT }, async () => {
    // Capture every change-listener callback registered during assemble, then
    // fire one after the fact to drive the try/catch warn branch.
    const { ProviderConfigStore } = await import("@agentprism/provider-catalog");
    const callbacks: Array<() => void> = [];
    vi.spyOn(ProviderConfigStore.prototype, "addChangeListener").mockImplementation((cb: () => void) => {
      callbacks.push(cb);
      return () => undefined;
    });
    vi.spyOn(DimensionRouter.prototype, "invalidateProviderCache").mockImplementation(() => {
      throw new Error("provider cache busted");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { assemble } = await import("../src/assemble.js");
    const components = await assemble();

    // assemble registers exactly one listener; firing it must surface the warn.
    expect(callbacks.length).toBeGreaterThan(0);
    callbacks[0]?.();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Provider cache invalidate failed"),
    );
    await components.flushDurableStores();
  });

  it("warns (does not throw) when initial model option sync fails", { timeout: COMPOSITION_TIMEOUT }, async () => {
    const sync = vi
      .spyOn(DimensionRouter.prototype, "syncModelOptionsFromProvider")
      .mockImplementation(() => {
        throw new Error("provider sync blew up");
      });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { assemble } = await import("../src/assemble.js");
    const components = await assemble();

    expect(sync).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Initial model option sync failed"));
    await components.flushDurableStores();
  });
});