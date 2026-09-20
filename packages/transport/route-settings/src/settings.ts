/**
 * @file routes/settings
 * @description Runtime knob and memory status routes.
 *
 * Responsibilities:
 * - Register GET/PUT /api/settings/knobs (read + hot-apply updates)
 * - Register GET /api/settings/memory and POST /api/settings/memory/clear
 *
 * The controllers arrive on HttpApplicationDeps (composition root owns the
 * knob store and the memory stores); absent controllers skip registration so
 * a host without the seams keeps booting.
 */

import type { HttpApplicationDeps } from "@agentprism/http-runtime";
import { readJsonRaw, type HttpApp } from "@agentprism/http-runtime";

/** Registers the settings knob + memory status routes. */
export function registerSettingsRoutes(app: HttpApp, deps: HttpApplicationDeps): void {
  const { runtimeKnobs, memoryStatus } = deps;
  if (runtimeKnobs !== undefined) {
    app.get("/api/settings/knobs", (c) =>
      c.json({ knobs: runtimeKnobs.current(), fields: runtimeKnobs.fields() }),
    );
    app.put("/api/settings/knobs", async (c) => {
      const body = await readJsonRaw(c);
      return c.json({ knobs: runtimeKnobs.update(body), fields: runtimeKnobs.fields() });
    });
  }
  if (memoryStatus !== undefined) {
    app.get("/api/settings/memory", (c) => c.json(memoryStatus.status()));
    app.post("/api/settings/memory/clear", (c) => {
      memoryStatus.clear();
      return c.json(memoryStatus.status());
    });
  }
}
