/**
 * @file provider-settings-routes tests
 * @description Locks provider settings routes: read, save, and connection test.
 */

import { describe, expect, it } from "vitest";
import { buildTestApp, mockDeps } from "./mock-deps.js";

describe("http-app provider settings", () => {
  it("GET /api/settings/provider returns provider config", async () => {
    const deps = mockDeps();
    const app = buildTestApp(deps);
    const res = await app.request("/api/settings/provider");
    expect(res.status).toBe(200);
    expect(deps.providers.getProvider).toHaveBeenCalledOnce();
  });

  it("POST /api/settings/provider/test with empty body calls testProvider(null)", async () => {
    const deps = mockDeps();
    const app = buildTestApp(deps);
    const res = await app.request("/api/settings/provider/test", { method: "POST" });
    expect(res.status).toBe(200);
    expect(deps.providers.testProvider).toHaveBeenCalledWith(null);
  });

  it("PUT /api/settings/provider saves and returns the provider", async () => {
    const deps = mockDeps();
    const res = await buildTestApp(deps).request("/api/settings/provider", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(deps.providers.saveProvider).toHaveBeenCalledOnce();
  });

  it("POST /api/settings/provider/test rejects malformed JSON with 400", async () => {
    const res = await buildTestApp(mockDeps()).request("/api/settings/provider/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "oops",
    });
    expect(res.status).toBe(400);
  });
});
