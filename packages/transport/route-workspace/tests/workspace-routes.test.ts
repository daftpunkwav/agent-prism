/**
 * @file workspace routes tests
 * @description Locks the workspace file surface: list/read/write/delete mapping and path validation.
 */

import { describe, expect, it, vi } from "vitest";
import { createHttpApplication, type HttpApplicationDeps } from "@agentprism/http-runtime";
import { registerWorkspaceRoutes } from "../src/workspace.js";

function testApp() {
  const workspaces = {
    listFiles: vi.fn(() => ({ workspace: "ws-a", files: [{ path: "src/a.ts" }] })),
    readFile: vi.fn(() => ({ path: "src/a.ts", content: "file body" })),
    writeFile: vi.fn(() => ({ path: "src/a.ts", message: "written" })),
    deleteFile: vi.fn(() => ({ path: "src/a.ts", message: "deleted" })),
  };
  const deps = {
    settings: {
      corsOrigins: "",
      frontendPort: 3000,
      apiToken: "",
      maxRequestSize: 1024 * 1024,
      backendHost: "127.0.0.1",
      backendPort: 8281,
      maxConcurrentRuns: 2,
    },
    workspaces,
  } as unknown as HttpApplicationDeps;
  const app = createHttpApplication(deps);
  registerWorkspaceRoutes(app, deps);
  return { app, workspaces };
}

describe("workspace file routes", () => {
  it("lists a workspace's files", async () => {
    const { app, workspaces } = testApp();
    const res = await app.request("/api/arena/workspace/ws-a/files");
    expect(res.status).toBe(200);
    await expect(res.json() as Promise<{ workspace: string }>).resolves.toMatchObject({ workspace: "ws-a" });
    expect(workspaces.listFiles).toHaveBeenCalledWith("ws-a");
  });

  it("reads a file by query path and rejects a missing path with 400", async () => {
    const { app, workspaces } = testApp();
    const res = await app.request("/api/arena/workspace/ws-a/file?path=src/a.ts");
    expect(res.status).toBe(200);
    await expect(res.json() as Promise<{ content: string }>).resolves.toMatchObject({ content: "file body" });
    expect(workspaces.readFile).toHaveBeenCalledWith("ws-a", "src/a.ts");

    const bad = await app.request("/api/arena/workspace/ws-a/file");
    expect(bad.status).toBe(400);
    await expect(bad.json() as Promise<{ detail: string }>).resolves.toMatchObject({ detail: /path/i });
  });

  it("writes a file with schema defaults and rejects an invalid body with 422", async () => {
    const { app, workspaces } = testApp();
    const res = await app.request("/api/arena/workspace/ws-a/file", {
      method: "PUT",
      body: JSON.stringify({ path: "src/a.ts", content: "new body" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect(workspaces.writeFile).toHaveBeenCalledWith("ws-a", {
      path: "src/a.ts",
      content: "new body",
      create_only: false,
    });

    const bad = await app.request("/api/arena/workspace/ws-a/file", {
      method: "PUT",
      body: JSON.stringify({ content: "no path" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(bad.status).toBe(422);
  });

  it("deletes a file by query path and rejects a missing path with 400", async () => {
    const { app, workspaces } = testApp();
    const res = await app.request("/api/arena/workspace/ws-a/file?path=src/a.ts", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(workspaces.deleteFile).toHaveBeenCalledWith("ws-a", "src/a.ts");

    const bad = await app.request("/api/arena/workspace/ws-a/file", { method: "DELETE" });
    expect(bad.status).toBe(400);
  });
});
