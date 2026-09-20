/**
 * @file routes/workspace
 * @description Workspace file routes: list, read, write, delete.
 *
 * Responsibilities:
 * - Register workspace endpoints and map to application use cases
 */

import { WorkspaceFileUpsertSchema } from "@agentprism/contracts";
import { AppError } from "@agentprism/application";
import type { HttpApplicationDeps } from "@agentprism/http-runtime";
import { parseJsonBody, type HttpApp } from "@agentprism/http-runtime";

/** Workspace file routes: list / read / write / delete. */
export function registerWorkspaceRoutes(app: HttpApp, deps: HttpApplicationDeps): void {
  app.get("/api/arena/workspace/:workspaceName/files", (c) =>
    c.json(deps.workspaces.listFiles(c.req.param("workspaceName"))),
  );

  app.get("/api/arena/workspace/:workspaceName/file", (c) => {
    const path = c.req.query("path");
    if (path === undefined || path === "") {
      throw AppError.badRequest("Missing path parameter");
    }
    return c.json(deps.workspaces.readFile(c.req.param("workspaceName"), path));
  });

  app.put("/api/arena/workspace/:workspaceName/file", async (c) => {
    const body = await parseJsonBody(c, WorkspaceFileUpsertSchema);
    return c.json(deps.workspaces.writeFile(c.req.param("workspaceName"), body));
  });

  app.delete("/api/arena/workspace/:workspaceName/file", (c) => {
    const path = c.req.query("path");
    if (path === undefined || path === "") {
      throw AppError.badRequest("Missing path parameter");
    }
    return c.json(deps.workspaces.deleteFile(c.req.param("workspaceName"), path));
  });
}
