/**
 * @file routes/provider
 * @description Provider settings routes: read, save, connectivity test.
 *
 * Responsibilities:
 * - Register provider endpoints and map to application use cases
 */

import { AppError, ProviderService } from "@agentprism/application";
import type { HttpApplicationDeps } from "@agentprism/http-runtime";
import { readJsonRaw, readRawBodyText, type HttpApp } from "@agentprism/http-runtime";

/** Provider settings routes: read / save / connectivity test. */
export function registerProviderRoutes(app: HttpApp, deps: HttpApplicationDeps): void {
  app.get("/api/settings/provider", (c) => c.json(deps.providers.getProvider()));

  app.put("/api/settings/provider", async (c) => {
    const body = await readJsonRaw(c);
    const update = ProviderService.parseUpdate(body);
    return c.json(await deps.providers.saveProvider(update));
  });

  app.post("/api/settings/provider/test", async (c) => {
    // Same streaming size enforcement as readJsonRaw (this route allows an empty body, so it skips parseJsonBody)
    const raw = await readRawBodyText(c);
    let body: unknown = null;
    if (raw.trim() !== "") {
      try {
        body = JSON.parse(raw);
      } catch {
        throw AppError.badRequest("Request body is not valid JSON");
      }
    }
    const update = body === null ? null : ProviderService.parseUpdate(body);
    return c.json(await deps.providers.testProvider(update));
  });
}
