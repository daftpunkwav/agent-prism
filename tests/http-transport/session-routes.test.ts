/**
 * @file session-routes tests
 * @description Locks the session routes: list, filter, detail, 404, and delete.
 */

import { describe, expect, it } from "vitest";
import { buildTestApp, mockDeps } from "./mock-deps.js";

/** Seeds two sessions, the second completed, over a fresh app. */
async function seededApp() {
  const deps = mockDeps();
  await deps.sessions.startSession("arena", "first run");
  const second = await deps.sessions.startSession("agent", "second run");
  await deps.sessions.completeSession(second.id, "done");
  return { app: buildTestApp(deps), second };
}

describe("session routes", () => {
  it("lists sessions newest-first", async () => {
    const { app } = await seededApp();
    const all = (await (await app.request("/api/sessions")).json()) as any;
    expect(all.sessions.map((s: any) => s.title)).toEqual(["second run", "first run"]);
  });

  it("filters by status", async () => {
    const { app } = await seededApp();
    const active = (await (await app.request("/api/sessions?status=active")).json()) as any;
    expect(active.sessions).toHaveLength(1);
  });

  it("returns detail and 404 for a missing id", async () => {
    const { app, second } = await seededApp();
    const detail = (await (await app.request(`/api/sessions/${second.id}`)).json()) as any;
    expect(detail.record.status).toBe("completed");
    expect(detail.entries).toEqual([]);
    expect((await app.request("/api/sessions/ses-missing")).status).toBe(404);
  });

  it("deletes a session", async () => {
    const { app, second } = await seededApp();
    const del = await app.request(`/api/sessions/${second.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect((await app.request(`/api/sessions/${second.id}`)).status).toBe(404);
  });
});
