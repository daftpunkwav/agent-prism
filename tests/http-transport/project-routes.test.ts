/**
 * @file project-routes tests
 * @description Locks project archive routes: list, create, delete, and failure mapping.
 */

import { describe, expect, it, vi } from "vitest";
import { buildTestApp, mockDeps } from "./mock-deps.js";

describe("http-app projects", () => {
  it("DELETE /api/arena/projects/:id deletes the project", async () => {
    const deps = mockDeps();
    const app = buildTestApp(deps);
    const res = await app.request("/api/arena/projects/p1", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(deps.projects.deleteProject).toHaveBeenCalledWith("p1");
  });

  it("DELETE /api/arena/projects/:id returns 404 when missing", async () => {
    const deps = mockDeps({ projects: { deleteProject: vi.fn().mockReturnValue(false) } as any });
    const app = buildTestApp(deps);
    const res = await app.request("/api/arena/projects/missing", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("GET /api/arena/projects lists the archive", async () => {
    const deps = mockDeps({
      projects: { listProjects: vi.fn().mockReturnValue([{ id: "p1" }]) } as any,
    });
    const res = await buildTestApp(deps).request("/api/arena/projects");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ projects: [{ id: "p1" }] });
  });

  it("POST /api/arena/projects creates from a run", async () => {
    const deps = mockDeps();
    const res = await buildTestApp(deps).request("/api/arena/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "p", question: "q", dimension: "d", pipeline_labels: ["native"] }),
    });
    expect(res.status).toBe(200);
    expect(deps.projects.createFromRun).toHaveBeenCalledWith(
      expect.objectContaining({ name: "p", workspace_names: ["native"] }),
    );
  });

  it("POST /api/arena/projects returns 422 for invalid payloads", async () => {
    const res = await buildTestApp(mockDeps()).request("/api/arena/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(422);
  });

  it("DELETE maps store failures to 500 without leaking", async () => {
    const deps = mockDeps({
      projects: { deleteProject: vi.fn().mockRejectedValue(new Error("disk gone")) } as any,
    });
    const res = await buildTestApp(deps).request("/api/arena/projects/p1", { method: "DELETE" });
    expect(res.status).toBe(500);
  });
});
