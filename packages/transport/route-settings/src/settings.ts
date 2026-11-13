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
 * 409; unknown names and known validation defects answer 400 (see
 * skillErrorStatus). Unexpected store failures (EACCES, ENOSPC, an unconfigured
 * store) are rethrown to the shell's 5xx mapping instead of being misreported as
 * bad input. MCP replace failures parse as 400 with the parser's message, and an
 * MCP persistence failure likewise propagates to the 5xx mapping.
 *
 * Error-code contract (deliberately different from the schema-validated route
 * families): every settings endpoint validates by hand and answers 400 with a
 * `{detail}` body for malformed input, while the arena/builder/threads families
 * parse through zod (parseJsonBody) and answer 422 for schema mismatches.
 * Malformed JSON is 400 everywhere. The split is historical, not accidental
 * drift: settings payloads are operator state patches where a field-level 400
 * reads better than a 422; keep new settings endpoints in the 400 family.
 * Non-object JSON bodies (null, arrays, scalars) answer 400 on every route that
 * reads a field from the body.
 *
 * Knobs PUT answers 200 for every valid JSON payload: invalid or out-of-range
 * fields silently clamp or fall back to the current value (normalize semantics),
 * and the response's `knobs` carries the effective values — clients detect a
 * fallback by diffing the request against the response. Malformed JSON is 400 and
 * a store write failure is 500, like every other settings endpoint.
 */

import type { HttpApplicationDeps } from "@agentprism/http-runtime";
import { readJsonRaw, type HttpApp } from "@agentprism/http-runtime";
import { McpStoreError } from "@agentprism/contracts";

/**
 * Skill store errors are plain Errors with operator-readable messages; the two
 * identity sentinels ("read-only" bundled skills, "already exists" name
 * collisions) map to 409 Conflict, every other defect (unknown name, invalid
 * input) maps to 400.
 */
function skillErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Recognized skill-store defects: validation messages and identity sentinels the
 * store throws for bad operator input. Anything else (a filesystem error, an
 * unconfigured store) is a host failure and must not be reported as bad input.
 */
const KNOWN_SKILL_ERROR_PREFIXES = [
  "name must be ",
  "description must be ",
  "body must be ",
  "unknown user skill",
  "invalid skill name",
] as const;

/** Whether a skill-store error is a known validation/identity defect answerable with 400/409. */
function isKnownSkillError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  const message = error.message;
  return (
    KNOWN_SKILL_ERROR_PREFIXES.some((prefix) => message.startsWith(prefix)) ||
    message.includes("read-only") ||
    message.includes("already exists")
  );
}

function skillErrorStatus(error: unknown): 400 | 409 {
  const message = skillErrorDetail(error);
  // Defects answer 400 before the identity sentinels are consulted: the unknown-name
  // message quotes the requested name, so a legal kebab name such as
  // "read-only-notes" would otherwise be reported as a 409 bundled-skill conflict.
  if (message.startsWith("unknown user skill") || message.startsWith("invalid")) return 400;
  return message.includes("read-only") || message.includes("already exists") ? 409 : 400;
}

/** True for the plain JSON object subset the hand-validated routes read fields from. */
function isRequestBodyObject(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw);
}

/**
 * Narrows a parsed JSON body to the plain object these hand-validated endpoints
 * read fields from. A body that is null, an array, or a scalar is a malformed
 * payload, not a server fault: treating it as an empty object makes the
 * per-field checks answer 400 instead of crashing a property read into a 500.
 */
function requestBodyObject(raw: unknown): Record<string, unknown> {
  return isRequestBodyObject(raw) ? raw : {};
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
    app.post("/api/settings/memory/clear", async (c) => {
      // Clearing persists; awaiting turns a write failure into the mapped 5xx.
      await memoryStatus.clear();
      return c.json(memoryStatus.status());
    });
  }
  if (skills !== undefined) {
    app.get("/api/settings/skills", (c) => c.json({ skills: skills.list() }));
    app.post("/api/settings/skills", async (c) => {
      const body = requestBodyObject(await readJsonRaw(c));
      const name = typeof body.name === "string" ? body.name : "";
      const description = typeof body.description === "string" ? body.description : "";
      const bodyText = typeof body.body === "string" ? body.body : "";
      try {
        return c.json({ skill: skills.create({ name, description, body: bodyText }) }, 201);
      } catch (error) {
        if (!isKnownSkillError(error)) throw error;
        return c.json({ detail: skillErrorDetail(error) }, skillErrorStatus(error));
      }
    });
    app.put("/api/settings/skills/:name", async (c) => {
      const name = c.req.param("name");
      const raw = await readJsonRaw(c);
      // A non-object body is malformed input, not an empty patch: without this the
      // update route silently answered 200 for null/array/scalar JSON.
      if (!isRequestBodyObject(raw)) return c.json({ detail: "Request body must be a JSON object" }, 400);
      try {
        return c.json({
          skill: skills.update(name, {
            description: typeof raw.description === "string" ? raw.description : undefined,
            body: typeof raw.body === "string" ? raw.body : undefined,
          }),
        });
      } catch (error) {
        if (!isKnownSkillError(error)) throw error;
        return c.json({ detail: skillErrorDetail(error) }, skillErrorStatus(error));
      }
    });
    app.delete("/api/settings/skills/:name", (c) => {
      try {
        skills.remove(c.req.param("name"));
        return c.json({ ok: true });
      } catch (error) {
        if (!isKnownSkillError(error)) throw error;
        return c.json({ detail: skillErrorDetail(error) }, skillErrorStatus(error));
      }
    });
    app.put("/api/settings/skills/:name/enabled", async (c) => {
      const body = requestBodyObject(await readJsonRaw(c));
      if (typeof body.enabled !== "boolean") return c.json({ detail: "enabled must be a boolean" }, 400);
      try {
        skills.setEnabled(c.req.param("name"), body.enabled);
        return c.json({ ok: true });
      } catch (error) {
        if (!isKnownSkillError(error)) throw error;
        return c.json({ detail: skillErrorDetail(error) }, skillErrorStatus(error));
      }
    });
  }
  if (mcp !== undefined) {
    app.get("/api/settings/mcp", (c) => c.json({ servers: mcp.list() }));
    app.put("/api/settings/mcp", async (c) => {
      const body = requestBodyObject(await readJsonRaw(c));
      if (!Array.isArray(body.servers)) return c.json({ detail: "servers must be an array" }, 400);
      try {
        return c.json({ servers: mcp.replace(body.servers) });
      } catch (error) {
        // Validation is the request's fault; a write failure (disk full, EACCES) is
        // ours and must not read as "your request was invalid". McpStoreError is
        // single-sourced in contracts, so this leaf identifies it by instanceof
        // without a tool-mcp package edge.
        if (!(error instanceof McpStoreError)) throw error;
        return c.json({ detail: error.message }, 400);
      }
    });
  }
}
