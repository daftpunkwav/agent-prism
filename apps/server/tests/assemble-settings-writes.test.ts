/**
 * @file assemble settings-write tests
 * @description Drives the composed host's settings mutation surface end to end:
 * the skills CRUD, the MCP server replace, the memory clear, the provider
 * write/test round-trip, and the shutdown hooks.
 *
 * These paths reach the composition root's own collaborator closures, so a
 * mis-wired store shows up here as a wrong response instead of a working route
 * that silently mutates nothing.
 *
 * The suite writes only through the API and restores every touched value.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";

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

// Driver import pulls the langchain chain; mirrors the other composition suites.
const COMPOSITION_TIMEOUT = 120_000;

type TestApp = { request: (input: string, init?: RequestInit) => Response | Promise<Response> };

const json = (body: unknown, method = "POST") => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

describe("assemble() settings writes", () => {
  let app: TestApp;
  let flushDurableStores: () => Promise<void>;
  let checkpointStores: () => Promise<void>;
  let originalKnobs: Record<string, unknown> | null = null;
  let skillName: string | null = null;
  let originalMcpServers: unknown[] | null = null;

  beforeAll(async () => {
    const { assemble } = await import("../src/assemble.js");
    ({ app, flushDurableStores, checkpointStores } = await assemble());
  }, COMPOSITION_TIMEOUT);

  afterAll(async () => {
    // Leave the operator's local stores as they were found.
    if (originalKnobs !== null) {
      await app.request("/api/settings/knobs", json(originalKnobs, "PUT"));
    }
    if (skillName !== null) {
      await app.request(`/api/settings/skills/${skillName}`, { method: "DELETE" });
    }
    if (originalMcpServers !== null) {
      await app.request("/api/settings/mcp", json({ servers: originalMcpServers }, "PUT"));
    }
    await flushDurableStores();
  });

  it("round-trips a user skill through create, update, toggle, and delete", async () => {
    const created = await app.request(
      "/api/settings/skills",
      json({ name: "wiring-skill", description: "created by a wiring test", body: "step one" }),
    );
    expect(created.status).toBe(201);
    skillName = ((await created.json()) as { skill: { name: string } }).skill.name;
    expect(skillName).toBe("wiring-skill");

    const listed = (await (await app.request("/api/settings/skills")).json()) as { skills: Array<{ name: string }> };
    expect(listed.skills.map((skill) => skill.name)).toContain(skillName);

    const updated = await app.request(`/api/settings/skills/${skillName}`, json({ description: "updated" }, "PUT"));
    expect(updated.status).toBe(200);

    const disabled = await app.request(`/api/settings/skills/${skillName}/enabled`, json({ enabled: false }, "PUT"));
    expect(disabled.status).toBe(200);
    expect(await disabled.json()).toEqual({ ok: true });

    expect((await app.request(`/api/settings/skills/${skillName}`, { method: "DELETE" })).status).toBe(200);
    // The second delete reports the skill as unknown instead of succeeding silently.
    expect((await app.request(`/api/settings/skills/${skillName}`, { method: "DELETE" })).status).toBeGreaterThanOrEqual(400);
    skillName = null;
  });

  it("rejects a skill toggle that is not a boolean and a create without a name", async () => {
    const bad = await app.request("/api/settings/skills/grading/enabled", json({ enabled: "yes" }, "PUT"));
    expect(bad.status).toBe(400);
    const nameless = await app.request("/api/settings/skills", json({ description: "no name" }));
    expect(nameless.status).toBeGreaterThanOrEqual(400);
  });

  it("replaces the managed MCP list through the store", async () => {
    const before = (await (await app.request("/api/settings/mcp")).json()) as { servers: unknown[] };
    originalMcpServers = before.servers;

    const entry = { command: "node wiring-mcp.js", name: "wiring-mcp", enabled: false, args: ["--stdio"] };
    const replaced = await app.request("/api/settings/mcp", json({ servers: [entry] }, "PUT"));
    expect(replaced.status).toBe(200);
    const next = (await (await app.request("/api/settings/mcp")).json()) as { servers: Array<Record<string, unknown>> };
    expect(next.servers).toMatchObject([entry]);

    // The route rejects a body that is not a server list.
    expect((await app.request("/api/settings/mcp", json({ servers: "nope" }, "PUT"))).status).toBe(400);
  });

  it("clears both memory stores and reports empty counts", async () => {
    // The clear route writes through to the store files, so the operator's local
    // memory is read first and put back byte-for-byte afterwards: the test owns
    // the endpoint contract, not the local data.
    const memoryFiles = ["data/memory_episodic.json", "data/memory_semantic.json"];
    const before = new Map(
      memoryFiles.map((file) => [file, fs.existsSync(file) ? fs.readFileSync(file) : null] as const),
    );
    try {
      const cleared = await app.request("/api/settings/memory/clear", { method: "POST" });
      expect(cleared.status).toBe(200);
      const body = (await cleared.json()) as { episodicCount: number; semanticCount: number; episodicPath: string };
      expect(body).toMatchObject({ episodicCount: 0, semanticCount: 0 });
      expect(body.episodicPath).toContain("memory_episodic.json");
    } finally {
      for (const [file, content] of before) {
        if (content !== null) fs.writeFileSync(file, content);
      }
    }
  });

  it("hot-applies a runtime knob update through the store", async () => {
    const before = (await (await app.request("/api/settings/knobs")).json()) as {
      knobs: Record<string, unknown>;
      fields: Array<{ key: string }>;
    };
    originalKnobs = before.knobs;
    expect(before.fields.length).toBeGreaterThan(0);

    // Pick a value inside the knob's range and different from the current one.
    const current = Number(before.knobs["llmMaxRetries"]);
    const next = current === 4 ? 3 : 4;
    const updated = await app.request("/api/settings/knobs", json({ llmMaxRetries: next }, "PUT"));
    expect(updated.status).toBe(200);
    const after = (await updated.json()) as { knobs: Record<string, unknown> };
    expect(after.knobs["llmMaxRetries"]).toBe(next);

    // An unknown knob key is dropped by the schema, never stored.
    const unknown = await app.request("/api/settings/knobs", json({ notAKnob: 1 }, "PUT"));
    expect(unknown.status).toBe(200);
    const afterUnknown = (await unknown.json()) as { knobs: Record<string, unknown> };
    expect(afterUnknown.knobs).not.toHaveProperty("notAKnob");
    expect(afterUnknown.knobs["llmMaxRetries"]).toBe(next);
  });

  it("saves an identical provider config and survives a failed connection test", async () => {
    const provider = (await (await app.request("/api/settings/provider")).json()) as {
      endpoints: Array<Record<string, unknown>>;
    };
    const first = provider.endpoints[0];
    expect(first).toBeDefined();

    // Re-applying the public view keeps the stored config (the empty key means
    // "unchanged"), which exercises the update path without editing the file.
    const savedAgain = await app.request("/api/settings/provider", json({ endpoints: provider.endpoints }, "PUT"));
    expect(savedAgain.status).toBe(200);
    const after = (await (await app.request("/api/settings/provider")).json()) as { endpoints: Array<Record<string, unknown>> };
    expect(after.endpoints).toEqual(provider.endpoints);

    // An unreachable endpoint reports a failure result, not a 5xx.
    const probe = await app.request(
      "/api/settings/provider/test",
      json({
        endpoints: [
          {
            id: String(first?.["id"] ?? ""),
            provider_name: String(first?.["provider_name"] ?? ""),
            api_format: String(first?.["api_format"] ?? "anthropic_messages"),
            base_url: "http://127.0.0.1:9/unreachable",
            api_key: "test-key",
            model: String(first?.["model"] ?? "test-model"),
            use_full_url: true,
          },
        ],
      }),
    );
    expect(probe.status).toBe(200);
    expect(await probe.json()).toHaveProperty("ok", false);
  });

  it("flushes and checkpoints every durable store on demand", async () => {
    // Both hooks are the shutdown path: they must resolve over the real stores.
    await expect(flushDurableStores()).resolves.toBeUndefined();
    await expect(checkpointStores()).resolves.toBeUndefined();
  });
});
