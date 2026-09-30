/**
 * @file assemble wiring tests
 * @description Drives the composed host's route families so the composition
 * root's lazy collaborators are exercised where they are actually built.
 *
 * Responsibilities:
 * - Pin that every registered route family answers from a real wired collaborator
 *   (provider config, knobs, memory, skills, MCP, sessions, arena, workspace,
 *   projects, builder, threads)
 * - Pin the provider round-trip and the builder session lifecycle end to end
 *
 * The boot smoke (`assemble.test.ts`) asserts the host starts; this suite asserts
 * what it serves, which is where an unwired factory would otherwise hide behind a
 * route that only answers 404s.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Data-dir isolation anchor
// ---------------------------------------------------------------------------
// This suite mutates durable stores through the API (builder session lifecycle).
// Without an anchor it would read and write the operator's real data/ directory,
// and on a fresh checkout (CI) provider_config.json does not exist, so every
// store load re-seeds in memory with fresh random endpoint ids and the provider
// round-trip pin can never hold. Setting ARENA_DATA_DIR before the dynamic
// assemble import (which loads the @agentprism/config path constants) relocates
// every data path to a private scratch copy. Plain module statement on purpose:
// it must run before any import that evaluates the config path chain.
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "assemble-wiring-"));
process.env.ARENA_DATA_DIR = dataRoot;

const SCRUBBED = ["BACKEND_HOST", "API_TOKEN", "MCP_SERVERS"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of SCRUBBED) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of SCRUBBED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

// Driver import pulls the langchain chain; the composition budget mirrors the boot smoke.
const COMPOSITION_TIMEOUT = 120_000;

describe("assemble() route wiring", () => {
  it(
    "serves every route family from its wired collaborator",
    { timeout: COMPOSITION_TIMEOUT },
    async () => {
      const { assemble } = await import("../src/assemble.js");
      const { app } = await assemble();
      const get = (path: string) => app.request(path);

      // Provider: the public view is the stored config, never a raw key.
      const provider = await get("/api/settings/provider");
      expect(provider.status).toBe(200);
      const providerBody = (await provider.json()) as Record<string, unknown>;
      expect(providerBody).not.toHaveProperty("api_key");
      expect(providerBody["endpoints"]).toBeDefined();

      // Runtime knobs: the store is wired with its field metadata.
      const knobs = await get("/api/settings/knobs");
      expect(knobs.status).toBe(200);
      const knobBody = (await knobs.json()) as { knobs: Record<string, unknown>; fields: unknown[] };
      expect(knobBody.fields.length).toBeGreaterThan(0);
      expect(knobBody.knobs["contextWindowMessages"]).toBeTypeOf("number");

      // Memory status points at the real store files.
      const memory = await get("/api/settings/memory");
      expect(memory.status).toBe(200);
      const memoryBody = (await memory.json()) as { episodicPath: string; semanticPath: string };
      expect(memoryBody.episodicPath).toContain("memory_episodic.json");

      // Skills and MCP list from their stores.
      const skills = await get("/api/settings/skills");
      expect(skills.status).toBe(200);
      expect(Array.isArray(((await skills.json()) as { skills: unknown[] }).skills)).toBe(true);
      const mcp = await get("/api/settings/mcp");
      expect(mcp.status).toBe(200);
      expect(Array.isArray(((await mcp.json()) as { servers: unknown[] }).servers)).toBe(true);

      // Sessions: listing, statistics, and the telemetry report all read the store.
      expect((await get("/api/sessions")).status).toBe(200);
      expect((await get("/api/sessions/stats")).status).toBe(200);
      const telemetry = await get("/api/sessions/telemetry");
      expect(telemetry.status).toBe(200);
      expect((await telemetry.text()).length).toBeGreaterThan(0);

      // Arena: meta, templates, and the per-column log reader.
      const meta = await get("/api/arena/meta");
      expect(meta.status).toBe(200);
      const templates = await get("/api/arena/templates");
      expect(templates.status).toBe(200);
      expect(((await templates.json()) as { templates: unknown[] }).templates.length).toBeGreaterThan(0);
      const logs = await get("/api/arena/column-logs?workspace=ws-none&label=Native");
      expect(logs.status).toBe(200);

      // Workspace files: an unknown workspace lists empty rather than failing.
      const files = await get("/api/arena/workspace/ws-none/files");
      expect([200, 404]).toContain(files.status);
      expect((await get("/api/arena/workspace/ws-none/file")).status).toBe(400);

      // Projects: listing over the archive store.
      expect((await get("/api/arena/projects")).status).toBe(200);

      // Builder: the catalog comes from the configured provider, and a session
      // round-trips through create → detail → patch → delete.
      const catalog = await get("/api/builder/catalog");
      expect(catalog.status).toBe(200);
      const catalogBody = (await catalog.json()) as { frameworks: unknown[]; endpoints: unknown[] };
      expect(Array.isArray(catalogBody.frameworks)).toBe(true);
      expect((await get("/api/builder/sessions")).status).toBe(200);

      const created = await app.request("/api/builder/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "wiring probe" }),
      });
      expect(created.status).toBe(200);
      const sessionId = ((await created.json()) as { id?: string }).id;
      expect(sessionId).toBeTypeOf("string");

      const detail = await get(`/api/builder/sessions/${sessionId ?? ""}`);
      expect(detail.status).toBe(200);
      const patched = await app.request(`/api/builder/sessions/${sessionId ?? ""}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "renamed probe" }),
      });
      expect(patched.status).toBe(200);
      const removed = await app.request(`/api/builder/sessions/${sessionId ?? ""}`, { method: "DELETE" });
      expect(removed.status).toBe(200);
      expect((await get(`/api/builder/sessions/${sessionId ?? ""}`)).status).toBe(404);

      // Threads: an empty archive lists, and an unknown thread is a 404.
      expect((await get("/api/threads")).status).toBe(200);
      expect((await get("/api/threads/th-missing")).status).toBe(404);
    },
  );

  it(
    "rejects an invalid provider edit at the boundary without persisting it",
    { timeout: COMPOSITION_TIMEOUT },
    async () => {
      const { assemble } = await import("../src/assemble.js");
      const { app } = await assemble();

      // An absent provider file re-seeds on every load with fresh random
      // endpoint ids, so a stored config must exist before the untouched-store
      // pin can hold. Persist the in-memory seed once through a legal PUT;
      // the endpoint id survives the round trip and both reads below agree.
      const seededView = (await (await app.request("/api/settings/provider")).json()) as {
        endpoints: Array<Record<string, unknown>>;
      };
      const seedFirst = seededView.endpoints[0];
      expect(seedFirst).toBeDefined();
      const seeded = await app.request("/api/settings/provider", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoints: [
            {
              id: String(seedFirst?.["id"] ?? ""),
              label: String(seedFirst?.["label"] ?? ""),
              provider_name: String(seedFirst?.["provider_name"] ?? ""),
              api_key: "",
              base_url: String(seedFirst?.["base_url"] ?? "https://seed.example.com/v1"),
              api_format: String(seedFirst?.["api_format"] ?? "anthropic_messages"),
              model: String(seedFirst?.["model"] ?? ""),
            },
          ],
        }),
      });
      expect(seeded.status).toBe(200);

      const before = (await (await app.request("/api/settings/provider")).json()) as {
        endpoints: Array<Record<string, unknown>>;
      };
      const first = before.endpoints[0];
      expect(first).toBeDefined();
      // The public view exposes the key presence and a masked preview, never the value.
      expect(JSON.stringify(before)).not.toContain("api_key\":\"");
      expect(first).not.toHaveProperty("api_key");

      const endpoint = {
        id: String(first?.["id"] ?? ""),
        label: String(first?.["label"] ?? ""),
        provider_name: String(first?.["provider_name"] ?? ""),
        api_key: "",
        base_url: "not a url",
        api_format: String(first?.["api_format"] ?? "anthropic_messages"),
        model: String(first?.["model"] ?? ""),
      };
      const invalid = await app.request("/api/settings/provider", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoints: [endpoint] }),
      });
      expect(invalid.status).toBe(422);

      // The stored config is untouched by the rejected edit.
      const after = (await (await app.request("/api/settings/provider")).json()) as {
        endpoints: Array<Record<string, unknown>>;
      };
      expect(after.endpoints[0]).toEqual(first);
    },
  );

  it(
    "hides disabled endpoints from the builder palette and gates claude sdk server-side",
    { timeout: COMPOSITION_TIMEOUT },
    async () => {
      const { assemble } = await import("../src/assemble.js");
      const { app } = await assemble();

      const seeded = await app.request("/api/settings/provider", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoints: [
            {
              id: "ep-live",
              label: "Live anthropic",
              provider_name: "probe",
              api_key: "",
              base_url: "https://live.example.com/v1",
              api_format: "anthropic_messages",
              model: "probe-model",
            },
            {
              id: "ep-off",
              label: "Disabled openai",
              provider_name: "probe",
              api_key: "",
              base_url: "https://off.example.com/v1",
              api_format: "openai_chat",
              model: "probe-model",
              enabled: false,
            },
            {
              id: "ep-openai",
              label: "Live openai",
              provider_name: "probe",
              api_key: "",
              base_url: "https://openai.example.com/v1",
              api_format: "openai_chat",
              model: "probe-model",
            },
          ],
        }),
      });
      expect(seeded.status).toBe(200);

      // The settings view keeps every endpoint (the operator manages the
      // disabled one there); the builder palette drops the disabled one.
      const providerView = (await (await app.request("/api/settings/provider")).json()) as {
        endpoints: Array<Record<string, unknown>>;
      };
      expect(providerView.endpoints.map((endpoint) => endpoint["id"]).sort()).toEqual(["ep-live", "ep-off", "ep-openai"]);

      const catalog = (await (await app.request("/api/builder/catalog")).json()) as {
        endpoints: Array<Record<string, unknown>>;
      };
      expect(catalog.endpoints.map((endpoint) => endpoint["id"]).sort()).toEqual(["ep-live", "ep-openai"]);

      // The claude sdk ↔ anthropic_messages gate rejects at configure time
      // (422) instead of surfacing as a mid-run driver failure.
      const create = async (body: Record<string, unknown>) =>
        app.request("/api/builder/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "gate probe", composition: body }),
        });
      expect((await create({ framework: "claude_agent_sdk", endpoint_id: "ep-live" })).status).toBe(200);
      const offFormat = await create({ framework: "claude_agent_sdk", endpoint_id: "ep-openai" });
      expect(offFormat.status).toBe(422);
      expect(((await offFormat.json()) as { detail?: string }).detail).toContain("anthropic_messages");
      // A disabled endpoint id is rejected at configure time too.
      const disabled = await create({ framework: "native", endpoint_id: "ep-off" });
      expect(disabled.status).toBe(422);
      expect(((await disabled.json()) as { detail?: string }).detail).toContain("ep-off");
    },
  );

  it(
    "keeps operator files when deleting a user skill directory",
    { timeout: COMPOSITION_TIMEOUT },
    async () => {
      const { assemble } = await import("../src/assemble.js");
      const { app } = await assemble();

      const created = await app.request("/api/settings/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "keeper-probe", description: "probe", body: "probe body" }),
      });
      expect(created.status).toBe(201);

      // An operator file parked beside SKILL.md must survive the skill delete:
      // only the skill file goes, never the directory's other contents.
      const skillDir = path.join(dataRoot, "skills", "keeper-probe");
      const operatorFile = path.join(skillDir, "NOTES.txt");
      fs.writeFileSync(operatorFile, "operator data", "utf-8");

      const removed = await app.request("/api/settings/skills/keeper-probe", { method: "DELETE" });
      expect(removed.status).toBe(200);
      expect(fs.existsSync(path.join(skillDir, "SKILL.md"))).toBe(false);
      expect(fs.readFileSync(operatorFile, "utf-8")).toBe("operator data");
    },
  );

  afterAll(() => {
    // The stores live in the suite's scratch data dir; discard it wholesale.
    fs.rmSync(dataRoot, { recursive: true, force: true });
    delete process.env.ARENA_DATA_DIR;
  });
});
