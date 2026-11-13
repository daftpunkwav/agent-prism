/**
 * @file settings-routes tests
 * @description Locks the knob, memory, skill, and MCP settings routes.
 *
 * Responsibilities:
 * - Read and hot-apply runtime knobs
 * - Report and clear memory status
 * - Skill CRUD with 409 (identity) vs 400 (defect) error mapping and 5xx for
 *   unexpected store failures
 * - MCP list/replace with 400 on invalid input
 * - Skip registration when the controllers are absent
 */

import { describe, expect, it } from "vitest";
import { buildTestApp, mockMemoryStatus } from "./mock-deps.js";

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

  it("answers 5xx when clearing memory cannot persist (never a floating rejection)", async () => {
    const app = buildTestApp({ memoryStatus: mockMemoryStatus({ failClear: "disk full" }) });
    const res = await app.request("/api/settings/memory/clear", { method: "POST" });
    // The store persists on clear; a rejected write must reach the client as a
    // server error instead of becoming an unhandled rejection that kills the host.
    expect(res.status).toBe(500);
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

  it("answers 500 when a skill store write fails, not 400", async () => {
    // EACCES/ENOSPC are host failures: they must reach the shell's 5xx mapping,
    // never read as "your request was invalid".
    const storeFailure = (): never => {
      throw new Error("EACCES: permission denied, open 'data/skills/x/SKILL.md'");
    };
    const app = buildTestApp({
      skills: {
        list: () => [],
        create: storeFailure,
        update: storeFailure,
        remove: storeFailure,
        setEnabled: storeFailure,
      },
    });
    const headers = { "Content-Type": "application/json" };
    const attempts = [
      { path: "/api/settings/skills", method: "POST", body: JSON.stringify({ name: "fresh", description: "d", body: "b" }) },
      { path: "/api/settings/skills/user-a", method: "PUT", body: JSON.stringify({ description: "new" }) },
      { path: "/api/settings/skills/user-a", method: "DELETE", body: undefined },
      { path: "/api/settings/skills/user-a/enabled", method: "PUT", body: JSON.stringify({ enabled: true }) },
    ] as const;
    for (const { path, method, body } of attempts) {
      const res = await app.request(path, { method, headers, ...(body === undefined ? {} : { body }) });
      expect(res.status, `${method} ${path}`).toBe(500);
    }
  });

  it("answers 400, never a 500, for a JSON null settings body", async () => {
    // A JSON `null` is a valid body: a null property read used to escape the
    // hand-validation as a TypeError and surface as a 500.
    const app = buildTestApp();
    const cases = [
      { path: "/api/settings/skills", method: "POST" },
      { path: "/api/settings/skills/user-a", method: "PUT" },
      { path: "/api/settings/skills/user-a/enabled", method: "PUT" },
      { path: "/api/settings/mcp", method: "PUT" },
    ] as const;
    for (const { path, method } of cases) {
      const res = await app.request(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: "null",
      });
      expect(res.status, `${method} ${path}`).toBe(400);
    }
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
