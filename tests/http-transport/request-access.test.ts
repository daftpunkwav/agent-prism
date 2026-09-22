/**
 * @file request-access tests
 * @description Locks the API-token gate: token required, token accepted, health exempt.
 */

import { describe, expect, it } from "vitest";
import { buildTestApp, mockDeps } from "./mock-deps.js";

describe("http-app API token", () => {
  it("returns 401 when no token is presented and a token is configured", async () => {
    const deps = mockDeps();
    (deps.settings as any).apiToken = "secret";
    const app = buildTestApp(deps);
    const res = await app.request("/api/arena/meta");
    expect(res.status).toBe(401);
  });

  it("accepts a correct bearer token", async () => {
    const deps = mockDeps();
    (deps.settings as any).apiToken = "secret";
    const app = buildTestApp(deps);
    const res = await app.request("/api/arena/meta", {
      headers: { Authorization: "Bearer secret" },
    });
    expect(res.status).toBe(200);
  });

  it("exempts health endpoints", async () => {
    const deps = mockDeps();
    (deps.settings as any).apiToken = "secret";
    const app = buildTestApp(deps);
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  it("rejects a wrong token of the same length (no early-exit bypass)", async () => {
    const deps = mockDeps();
    (deps.settings as any).apiToken = "secret";
    const app = buildTestApp(deps);
    const res = await app.request("/api/arena/meta", {
      headers: { Authorization: "Bearer secrit" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a prefix of the configured token", async () => {
    const deps = mockDeps();
    (deps.settings as any).apiToken = "secret-token-value";
    const app = buildTestApp(deps);
    const res = await app.request("/api/arena/meta", {
      headers: { Authorization: "Bearer secret" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects an empty bearer while a token is configured", async () => {
    const deps = mockDeps();
    (deps.settings as any).apiToken = "secret";
    const app = buildTestApp(deps);
    const res = await app.request("/api/arena/meta", {
      headers: { Authorization: "Bearer " },
    });
    expect(res.status).toBe(401);
  });

  it("accepts a correct X-API-Token header", async () => {
    const deps = mockDeps();
    (deps.settings as any).apiToken = "secret";
    const app = buildTestApp(deps);
    const res = await app.request("/api/arena/meta", {
      headers: { "X-API-Token": "secret" },
    });
    expect(res.status).toBe(200);
  });
});
