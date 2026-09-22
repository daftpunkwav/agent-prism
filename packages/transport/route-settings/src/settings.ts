/**
 * @file routes/settings
 * @description Runtime knob, memory, skill, and MCP management routes.
 *
 * Responsibilities:
 * - Register GET/PUT /api/settings/knobs (read + hot-apply updates)
 * - Register GET /api/settings/memory and POST /api/settings/memory/clear
 * - Register skill CRUD + enable toggle under /api/settings/skills
 * - Register GET/PUT /api/settings/mcp for the managed server list
 *
 * The controllers arrive on HttpApplicationDeps (composition root owns the
 * stores); absent controllers skip registration so a host without the seams
 * keeps booting. Skill writes reject bundled names and duplicate creates with
 * 409; unknown names and invalid input answer 400 (see skillErrorStatus).
 * MCP replace failures parse as 400 with the parser's message.
 */

import type { HttpApplicationDeps } from "@agentprism/http-runtime";
import { readJsonRaw, type HttpApp } from "@agentprism/http-runtime";

/**
 * Skill store errors are plain Errors with operator-readable messages; the two
 * identity sentinels ("read-only" bundled skills, "already exists" name
 * collisions) map to 409 Conflict, every other defect (unknown name, invalid
 * input) maps to 400.
 */
function skillErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function skillErrorStatus(error: unknown): 400 | 409 {
  const message = skillErrorDetail(error);
  return message.includes("read-only") || message.includes("already exists") ? 409 : 400;
}

/** Registers the settings knob, memory, skill, and MCP routes. */
export function registerSettingsRoutes(app: HttpApp, deps: HttpApplicationDeps): void {
  const { runtimeKnobs, memoryStatus, skills, mcp } = deps;
  if (runtimeKnobs !== undefined) {
    app.get("/api/settings/knobs", (c) =>
      c.json({ knobs: runtimeKnobs.current(), fields: runtimeKnobs.fields() }),
    );
    app.put("/api/settings/knobs", async (c) => {
      const body = await readJsonRaw(c);
      return c.json({ knobs: await runtimeKnobs.update(body), fields: runtimeKnobs.fields() });
    });
  }
  if (memoryStatus !== undefined) {
    app.get("/api/settings/memory", (c) => c.json(memoryStatus.status()));
    app.post("/api/settings/memory/clear", (c) => {
      memoryStatus.clear();
      return c.json(memoryStatus.status());
    });
  }
  if (skills !== undefined) {
    app.get("/api/settings/skills", (c) => c.json({ skills: skills.list() }));
    app.post("/api/settings/skills", async (c) => {
      const body = (await readJsonRaw(c)) as Record<string, unknown>;
      const name = typeof body.name === "string" ? body.name : "";
      const description = typeof body.description === "string" ? body.description : "";
      const bodyText = typeof body.body === "string" ? body.body : "";
      try {
        return c.json({ skill: skills.create({ name, description, body: bodyText }) }, 201);
      } catch (error) {
        return c.json({ detail: skillErrorDetail(error) }, skillErrorStatus(error));
      }
    });
    app.put("/api/settings/skills/:name", async (c) => {
      const name = c.req.param("name");
      const body = (await readJsonRaw(c)) as Record<string, unknown>;
      try {
        return c.json({
          skill: skills.update(name, {
            description: typeof body.description === "string" ? body.description : undefined,
            body: typeof body.body === "string" ? body.body : undefined,
          }),
        });
      } catch (error) {
        return c.json({ detail: skillErrorDetail(error) }, skillErrorStatus(error));
      }
    });
    app.delete("/api/settings/skills/:name", (c) => {
      try {
        skills.remove(c.req.param("name"));
        return c.json({ ok: true });
      } catch (error) {
        return c.json({ detail: skillErrorDetail(error) }, skillErrorStatus(error));
      }
    });
    app.put("/api/settings/skills/:name/enabled", async (c) => {
      const body = (await readJsonRaw(c)) as Record<string, unknown>;
      if (typeof body.enabled !== "boolean") return c.json({ detail: "enabled must be a boolean" }, 400);
      try {
        skills.setEnabled(c.req.param("name"), body.enabled);
        return c.json({ ok: true });
      } catch (error) {
        return c.json({ detail: error instanceof Error ? error.message : String(error) }, 400);
      }
    });
  }
  if (mcp !== undefined) {
    app.get("/api/settings/mcp", (c) => c.json({ servers: mcp.list() }));
    app.put("/api/settings/mcp", async (c) => {
      const body = (await readJsonRaw(c)) as Record<string, unknown>;
      if (!Array.isArray(body.servers)) return c.json({ detail: "servers must be an array" }, 400);
      try {
        return c.json({ servers: mcp.replace(body.servers) });
      } catch (error) {
        return c.json({ detail: error instanceof Error ? error.message : String(error) }, 400);
      }
    });
  }
}
