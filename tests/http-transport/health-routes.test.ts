/**
 * @file health-routes tests
 * @description Locks liveness probes: root and API health.
 */

import { describe, expect, it } from "vitest";
import { buildTestApp, mockDeps } from "./mock-deps.js";

describe("http-app health checks", () => {
  it("GET /health returns ok", async () => {
    const app = buildTestApp(mockDeps());
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok", service: "arena" });
  });

  it("GET /api/health returns ok", async () => {
    const app = buildTestApp(mockDeps());
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
  });

});
