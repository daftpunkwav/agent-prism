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
});
