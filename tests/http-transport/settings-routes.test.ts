/**
 * @file settings-routes tests
 * @description Locks the runtime-knob and memory-status settings routes.
 *
 * Responsibilities:
 * - Read and hot-apply runtime knobs
 * - Report and clear memory status
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

  it("leaves the routes unregistered when the controllers are absent", async () => {
    const app = buildTestApp({ runtimeKnobs: undefined, memoryStatus: undefined });
    expect((await app.request("/api/settings/knobs")).status).toBe(404);
    expect((await app.request("/api/settings/memory")).status).toBe(404);
  });
});
