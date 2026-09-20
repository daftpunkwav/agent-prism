/**
 * @file routes/projects
 * @description Project archive routes: list, create from run, delete.
 *
 * Responsibilities:
 * - Register project endpoints and map to application use cases
 */

import { ProjectCreateSchema, fillWorkspaceNames } from "@agentprism/contracts";
import { AppError } from "@agentprism/application";
import type { HttpApplicationDeps } from "@agentprism/http-runtime";
import { parseJsonBody, type HttpApp } from "@agentprism/http-runtime";

/** Project archive routes: list / create from run / delete. */
export function registerProjectRoutes(app: HttpApp, deps: HttpApplicationDeps): void {
  app.get("/api/arena/projects", (c) => c.json({ projects: deps.projects.listProjects() }));

  app.post("/api/arena/projects", async (c) => {
    const input = await parseJsonBody(c, ProjectCreateSchema);
    try {
      const project = await deps.projects.createFromRun(fillWorkspaceNames(input));
      return c.json({ project });
    } catch (error) {
      if (error instanceof AppError) throw error;
      console.warn(`[transport] Project save failed: ${error instanceof Error ? error.message : String(error)}`);
      throw AppError.internal("Failed to save project");
    }
  });

  app.delete("/api/arena/projects/:projectId", async (c) => {
    const projectId = c.req.param("projectId");
    let deleted: boolean;
    try {
      deleted = await deps.projects.deleteProject(projectId);
    } catch (error) {
      console.warn(`[transport] Project delete failed: ${error instanceof Error ? error.message : String(error)}`);
      throw AppError.internal("Failed to delete project");
    }
    if (!deleted) {
      throw AppError.notFound("Project not found");
    }
    return c.json({ deleted: projectId });
  });
}
