/**
 * @file workspace-file-routes tests
 * @description Locks workspace file routes: listing and missing-path rejection.
 */

import { describe, expect, it } from "vitest";
import { buildTestApp, mockDeps } from "./mock-deps.js";

describe("http-app workspace files", () => {
  it("GET /api/arena/workspace/:name/files returns file list", async () => {
    const deps = mockDeps();
    const app = buildTestApp(deps);
    const res = await app.request("/api/arena/workspace/test/files");
    expect(res.status).toBe(200);
    expect(deps.workspaces.listFiles).toHaveBeenCalledWith("test");
  });

  it("GET /api/arena/workspace/:name/file returns 400 when path is missing", async () => {
    const app = buildTestApp(mockDeps());
    const res = await app.request("/api/arena/workspace/test/file");
    expect(res.status).toBe(400);
  });

});
