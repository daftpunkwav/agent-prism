/**
 * @file arena-query-routes tests
 * @description Locks arena read/judge routes: meta, templates, judge forwarding and validation.
 */

import { describe, expect, it } from "vitest";
import { buildTestApp, mockDeps } from "./mock-deps.js";

describe("http-app arena queries", () => {
  it("GET /api/arena/meta returns dimension metadata", async () => {
    const deps = mockDeps();
    const app = buildTestApp(deps);
    const res = await app.request("/api/arena/meta");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("dimensions");
    expect(body).toHaveProperty("frameworks");
    expect(deps.arena.getMeta).toHaveBeenCalledOnce();
  });

  it("GET /api/arena/templates returns template list", async () => {
    const deps = mockDeps();
    const app = buildTestApp(deps);
    const res = await app.request("/api/arena/templates");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ templates: [] });
  });

  it("POST /api/arena/judge forwards the judge request", async () => {
    const deps = mockDeps();
    const app = buildTestApp(deps);
    const res = await app.request("/api/arena/judge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_id: "t", answers: { q1: "a" } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("template_id", "t");
    expect(deps.arena.judge).toHaveBeenCalledWith("t", { q1: "a" });
  });

  it("POST /api/arena/judge returns 422 when params are missing", async () => {
    const app = buildTestApp(mockDeps());
    const res = await app.request("/api/arena/judge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });

});
