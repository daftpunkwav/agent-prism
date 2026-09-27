/**
 * @file settings clients tests
 * @description Covers the settings-facing client helpers: runtime knobs, memory
 *              status, skills CRUD, and the MCP server list.
 *
 * Responsibilities:
 * - Pin request paths, methods, and JSON bodies for each helper
 * - Pin ApiError classification: server `detail` first, then the fallback message
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  clearMemory,
  createSkill,
  deleteSkill,
  fetchMcpServers,
  fetchMemoryStatus,
  fetchRuntimeKnobs,
  fetchSkills,
  saveMcpServers,
  saveRuntimeKnobs,
  setSkillEnabled,
  updateSkill,
} from "@agentprism/client";

interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Headers;
}

function stubFetch(handler: (call: Call) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((async (url: string | URL, init?: RequestInit) => {
      const call: Call = {
        url: String(url),
        method: init?.method ?? "GET",
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
        headers: new Headers(init?.headers),
      };
      calls.push(call);
      return handler(call);
    }) as unknown as typeof fetch),
  );
  return calls;
}

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runtime knobs client", () => {
  it("reads the knob payload and writes updates as a JSON body along the same path", async () => {
    const calls = stubFetch((call) =>
      json({ knobs: { contextWindowMessages: call.method === "PUT" ? 32 : 12 }, fields: [] }),
    );
    const read = await fetchRuntimeKnobs();
    expect(read.knobs["contextWindowMessages"]).toBe(12);
    const written = await saveRuntimeKnobs({ contextWindowMessages: 32 });
    expect(written.knobs["contextWindowMessages"]).toBe(32);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET /api/settings/knobs",
      "PUT /api/settings/knobs",
    ]);
    expect(calls[1]?.headers.get("Content-Type")).toContain("application/json");
  });

  it("reports failures with the HTTP status, preferring the server detail where it reads one", async () => {
    // The read path uses a fixed message; the write path surfaces the server's detail.
    stubFetch(() => json({ detail: "knobs unavailable" }, 500));
    await expect(fetchRuntimeKnobs()).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
      message: "Failed to load runtime knobs",
    });
    await expect(saveRuntimeKnobs({ contextWindowMessages: 1 })).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
      message: "knobs unavailable",
    });
  });
});

describe("memory status client", () => {
  it("reads status and posts a clear along the same path", async () => {
    const calls = stubFetch((call) =>
      json({ episodicCount: call.method === "POST" ? 0 : 3, semanticCount: 0, episodicPath: "a", semanticPath: "b" }),
    );
    expect((await fetchMemoryStatus()).episodicCount).toBe(3);
    expect((await clearMemory()).episodicCount).toBe(0);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET /api/settings/memory",
      "POST /api/settings/memory/clear",
    ]);
  });

  it("maps a failed clear to an ApiError carrying the status", async () => {
    stubFetch(() => new Response("boom", { status: 500 }));
    const error = await clearMemory().catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(500);
  });
});

describe("skills client", () => {
  it("lists, creates, updates, toggles, and deletes with the expected verbs and paths", async () => {
    const calls = stubFetch((call) => {
      if (call.method === "GET") return json({ skills: [{ name: "user-a" }] });
      return json({ ok: true });
    });

    expect(await fetchSkills()).toEqual([{ name: "user-a" }]);
    await createSkill({ name: "fresh-one", description: "d", body: "b" });
    await updateSkill("fresh-one", { description: "d2" });
    await setSkillEnabled("fresh-one", false);
    await deleteSkill("fresh-one");

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET /api/settings/skills",
      "POST /api/settings/skills",
      "PUT /api/settings/skills/fresh-one",
      "PUT /api/settings/skills/fresh-one/enabled",
      "DELETE /api/settings/skills/fresh-one",
    ]);
    expect(calls[1]?.body).toEqual({ name: "fresh-one", description: "d", body: "b" });
    expect(calls[3]?.body).toEqual({ enabled: false });
  });

  it("percent-encodes a skill name in every mutation path", async () => {
    const calls = stubFetch(() => json({ ok: true }));
    await updateSkill("weird name/../x", { body: "b" });
    expect(calls[0]?.url).toBe("/api/settings/skills/weird%20name%2F..%2Fx");
  });

  it("surfaces the server detail on a rejected create", async () => {
    stubFetch(() => json({ detail: "skill \"user-a\" already exists" }, 409));
    await expect(createSkill({ name: "user-a", description: "d", body: "b" })).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      message: 'skill "user-a" already exists',
    });
  });
});

describe("MCP servers client", () => {
  it("reads the list and replaces it through PUT with the array body", async () => {
    const calls = stubFetch((call) =>
      call.method === "PUT"
        ? json({ servers: [{ command: "npx -y demo", enabled: false }] })
        : json({ servers: [{ command: "npx -y demo", enabled: true }] }),
    );
    expect(await fetchMcpServers()).toEqual([{ command: "npx -y demo", enabled: true }]);
    const saved = await saveMcpServers([{ command: "npx -y demo", enabled: false }]);
    expect(saved).toEqual([{ command: "npx -y demo", enabled: false }]);
    expect(calls[1]?.method).toBe("PUT");
    expect(calls[1]?.body).toEqual({ servers: [{ command: "npx -y demo", enabled: false }] });
  });

  it("maps a rejected save to an ApiError with the status", async () => {
    stubFetch(() => json({ detail: "servers must be an array" }, 400));
    await expect(saveMcpServers([])).rejects.toMatchObject({ name: "ApiError", status: 400 });
  });
});
