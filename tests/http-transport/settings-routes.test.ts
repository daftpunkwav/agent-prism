/**
 * @file settings-routes tests
 * @description Locks the knob, memory, skill, and MCP settings routes.
 *
 * Responsibilities:
 * - Read and hot-apply runtime knobs
 * - Report and clear memory status
 * - Skill CRUD with 409 (identity) vs 400 (defect) error mapping
 * - MCP list/replace with 400 on invalid input
 * - Skip registration when the controllers are absent
 */

import { describe, expect, it } from "vitest";
import { buildTestApp } from "./mock-deps.js";

describe("settings routes", () => {
  it("reads runtime knobs with their field metadata", async () => {
    const app = buildTestApp();
    const res = await app.request("/api/settings/knobs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.knobs.contextWindowMessages).toBe(12);
    expect(Array.isArray(body.fields)).toBe(true);
  });

  it("hot-applies runtime knob updates, visible to the next read", async () => {
    const app = buildTestApp();
    const res = await app.request("/api/settings/knobs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contextWindowMessages: 32 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.knobs.contextWindowMessages).toBe(32);

    const reread = (await (await app.request("/api/settings/knobs")).json()) as any;
    expect(reread.knobs.contextWindowMessages).toBe(32);
  });

  it("reports memory status and clears both stores", async () => {
    const app = buildTestApp();
    const before = (await (await app.request("/api/settings/memory")).json()) as any;
    expect(before.episodicCount).toBe(2);
    expect(before.semanticCount).toBe(3);

    const cleared = await app.request("/api/settings/memory/clear", { method: "POST" });
    expect(cleared.status).toBe(200);
    const after = (await cleared.json()) as any;
    expect(after.episodicCount).toBe(0);
    expect(after.semanticCount).toBe(0);
  });

  it("creates, toggles, updates, and deletes a user skill over the routes", async () => {
    const app = buildTestApp();
    const listed = (await (await app.request("/api/settings/skills")).json()) as any;
    expect(listed.skills.map((skill: any) => skill.name)).toEqual(["bundled-a", "user-a"]);

    const created = await app.request("/api/settings/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "fresh-one", description: "d", body: "b" }),
    });
    expect(created.status).toBe(201);

    const enabled = await app.request("/api/settings/skills/fresh-one/enabled", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(enabled.status).toBe(200);

    const updated = await app.request("/api/settings/skills/fresh-one", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "new" }),
    });
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as any).skill.name).toBe("fresh-one");

    const deleted = await app.request("/api/settings/skills/fresh-one", { method: "DELETE" });
    expect(deleted.status).toBe(200);
  });

  it("maps skill identity conflicts to 409 and plain defects to 400", async () => {
    const app = buildTestApp();
    const duplicate = await app.request("/api/settings/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "user-a", description: "d", body: "b" }),
    });
    expect(duplicate.status).toBe(409);

    const invalid = await app.request("/api/settings/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Not Kebab!", description: "d", body: "b" }),
    });
    expect(invalid.status).toBe(400);

    const bundledDelete = await app.request("/api/settings/skills/bundled-a", { method: "DELETE" });
    expect(bundledDelete.status).toBe(409);

    const unknownDelete = await app.request("/api/settings/skills/missing", { method: "DELETE" });
    expect(unknownDelete.status).toBe(400);

    const nonBooleanEnabled = await app.request("/api/settings/skills/user-a/enabled", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: "yes" }),
    });
    expect(nonBooleanEnabled.status).toBe(400);
  });

  it("lists MCP servers and replaces the whole list", async () => {
    const app = buildTestApp();
    const listed = (await (await app.request("/api/settings/mcp")).json()) as any;
    expect(listed.servers).toHaveLength(1);
    expect(listed.servers[0].command).toBe("npx");

    const replaced = await app.request("/api/settings/mcp", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ servers: [{ command: "node", name: "local", enabled: false }] }),
    });
    expect(replaced.status).toBe(200);
    expect(((await replaced.json()) as any).servers[0].name).toBe("local");
  });

  it("rejects invalid MCP replaces with 400", async () => {
    const app = buildTestApp();
    const notArray = await app.request("/api/settings/mcp", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ servers: "nope" }),
    });
    expect(notArray.status).toBe(400);

    const badCommand = await app.request("/api/settings/mcp", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ servers: [{ command: "" }] }),
    });
    expect(badCommand.status).toBe(400);
    const detail = (await badCommand.json()) as any;
    expect(detail.detail).toContain("command");
  });

  it("leaves the routes unregistered when the controllers are absent", async () => {
    const app = buildTestApp({
      runtimeKnobs: undefined,
      memoryStatus: undefined,
      skills: undefined,
      mcp: undefined,
    });
    expect((await app.request("/api/settings/knobs")).status).toBe(404);
    expect((await app.request("/api/settings/memory")).status).toBe(404);
    expect((await app.request("/api/settings/skills")).status).toBe(404);
    expect((await app.request("/api/settings/mcp")).status).toBe(404);
  });
});
