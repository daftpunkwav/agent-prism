/**
 * @file mount-routes
 * @description Domain route assembly for the server host.
 *
 * Responsibilities:
 * - Mount every route leaf onto the HTTP shell (single source for composition)
 *
 * The shell knows no domain routes; each route leaf mounts itself here and
 * nowhere else. Covered by mount-routes tests (one endpoint per leaf).
 */

import { createHttpApplication, type HttpApp, type HttpApplicationDeps } from "@agentprism/http-runtime";
import { registerArenaRoutes } from "@agentprism/route-arena";
import { registerBuilderRoutes } from "@agentprism/route-builder";
import { registerProjectRoutes } from "@agentprism/route-projects";
import { registerProviderRoutes } from "@agentprism/route-provider";
import { registerSettingsRoutes } from "@agentprism/route-settings";
import { registerSessionRoutes } from "@agentprism/route-sessions";
import { registerThreadRoutes } from "@agentprism/route-threads";
import { registerWorkspaceRoutes } from "@agentprism/route-workspace";

/** Builds the composed HTTP application: shell plus every domain route leaf. */
export function mountDomainRoutes(deps: HttpApplicationDeps): HttpApp {
  const app = createHttpApplication(deps);
  registerProviderRoutes(app, deps);
  registerSettingsRoutes(app, deps);
  registerSessionRoutes(app, deps);
  registerArenaRoutes(app, deps);
  registerWorkspaceRoutes(app, deps);
  registerProjectRoutes(app, deps);
  registerBuilderRoutes(app, deps);
  registerThreadRoutes(app, deps);
  return app;
}
