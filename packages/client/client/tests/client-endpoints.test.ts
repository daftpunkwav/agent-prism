/**
 * @file client endpoints tests
 * @description Covers the non-streaming REST surface of the Arena API client.
 *
 * Responsibilities:
 * - Pin request method/path/body mapping for metadata, provider, judging,
 *   project, workspace-file, knobs, and memory endpoints
 * - Pin the saveProvider api_key omission/inheritance semantics
 * - Lock ApiError mapping and the shape-guarded column-logs payload
 *
 * All requests run against a stubbed global fetch; no server is started.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  answerArenaQuestion,
  clearMemory,
  createProject,
  deleteProject,
  deleteWorkspaceFile,
  fetchArenaMeta,
  fetchColumnLogs,
  fetchMemoryStatus,
  fetchProvider,
  fetchRuntimeKnobs,
  fetchTemplates,
  judgeAnswers,
  listProjects,
  listWorkspaceFiles,
  readWorkspaceFile,
  saveProvider,
  saveRuntimeKnobs,
  saveWorkspaceFile,
  stopArenaColumn,
  testProvider,
} from "@agentprism/client";

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return vi.fn((async (url: string | URL, init?: RequestInit) => handler(String(url), init)) as unknown as typeof fetch);
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("client REST endpoints", () => {
  it("fetches arena meta, provider, templates and knobs from their GET paths", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      stubFetch((url) => {
        seen.push(url);
        if (url.endsWith("/api/arena/meta")) return jsonResponse({ dimensions: [] });
        if (url.endsWith("/api/settings/provider")) return jsonResponse({ api_key: "sk" });
        if (url.endsWith("/api/arena/templates")) return jsonResponse({ templates: [{ id: "t" }] });
        if (url.endsWith("/api/settings/knobs")) return jsonResponse({ knobs: {} });
        return jsonResponse({});
      }),
    );
    expect(await fetchArenaMeta()).toEqual({ dimensions: [] });
    expect(await fetchProvider()).toEqual({ api_key: "sk" });
    expect(await fetchTemplates()).toEqual([{ id: "t" }]);
    expect(await fetchRuntimeKnobs()).toEqual({ knobs: {} });
    expect(seen.every((u) => u.startsWith("/api/"))).toBe(true);
  });

  it("fetchTemplates defaults a missing templates payload to []", async () => {
    vi.stubGlobal("fetch", stubFetch(() => jsonResponse({})));
    expect(await fetchTemplates()).toEqual([]);
  });

  it("saveProvider omits a blank top-level api_key but keeps blank endpoint keys", async () => {
    const seen: Array<{ url: string; method?: string; body?: string }> = [];
    vi.stubGlobal(
      "fetch",
      stubFetch((url, init) => {
        seen.push({ url, method: init?.method, body: typeof init?.body === "string" ? init.body : undefined });
        return jsonResponse({ ok: true });
      }),
    );
    await saveProvider({
      api_key: "  ",
      endpoints: [{ id: "e1", api_key: "  " }, { id: "e2", api_key: "sk-2" }],
    } as Parameters<typeof saveProvider>[0]);
    expect(seen[0]?.method).toBe("PUT");
    const body = JSON.parse(seen[0]?.body ?? "{}") as { api_key?: string; endpoints: Array<{ id: string; api_key: string }> };
    expect("api_key" in body).toBe(false); // blank top-level key omitted: backend keeps stored key
    expect(body.endpoints[0]?.api_key).toBe(""); // blank endpoint key kept empty: inherit by id
    expect(body.endpoints[1]?.api_key).toBe("sk-2");
  });

  it("saveProvider keeps a non-blank top-level key", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      stubFetch((_url, init) => {
        seen.push(String(init?.body));
        return jsonResponse({});
      }),
    );
    await saveProvider({ api_key: "sk-live" } as Parameters<typeof saveProvider>[0]);
    expect(JSON.parse(seen[0] ?? "{}")).toEqual({ api_key: "sk-live" });
  });

  it("tests provider connectivity without persisting (POST, never PUT)", async () => {
    const seen: Array<{ url: string; method?: string }> = [];
    vi.stubGlobal(
      "fetch",
      stubFetch((url, init) => {
        seen.push({ url, method: init?.method });
        return jsonResponse({ ok: true });
      }),
    );
    expect(await testProvider({} as Parameters<typeof testProvider>[0])).toEqual({ ok: true });
    expect(seen[0]?.url).toContain("/api/settings/provider/test");
    expect(seen[0]?.method).toBe("POST");
  });

  it("judges answers and defaults a missing results payload to {}", async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      stubFetch((_url, init) => {
        bodies.push(String(init?.body));
        return jsonResponse({ results: { laneA: { verdict: "correct" } } });
      }),
    );
    expect(await judgeAnswers("t1", { laneA: "42" })).toEqual({ laneA: { verdict: "correct" } });
    expect(JSON.parse(bodies[0] ?? "{}")).toEqual({ template_id: "t1", answers: { laneA: "42" } });
    vi.stubGlobal("fetch", stubFetch(() => jsonResponse({})));
    expect(await judgeAnswers("t1", {})).toEqual({});
  });

  it("lists and creates projects, deleting by encoded id", async () => {
    const seen: Array<{ url: string; method?: string }> = [];
    vi.stubGlobal(
      "fetch",
      stubFetch((url, init) => {
        seen.push({ url, method: init?.method });
        if (init?.method === "POST") return jsonResponse({ project: { id: "p1" } });
        if (init?.method === "DELETE") return jsonResponse({ deleted: "p/1" });
        return jsonResponse({ projects: [{ id: "p0" }] });
      }),
    );
    expect(await listProjects()).toEqual([{ id: "p0" }]);
    expect(await createProject({} as Parameters<typeof createProject>[0])).toEqual({ project: { id: "p1" } });
    await deleteProject("p/1");
    expect(seen[2]?.url).toContain(encodeURIComponent("p/1"));
    expect(seen[2]?.method).toBe("DELETE");
    vi.stubGlobal("fetch", stubFetch(() => jsonResponse({})));
    expect(await listProjects()).toEqual([]);
  });

  it("reads, writes and deletes workspace files with encoded segments", async () => {
    const seen: Array<{ url: string; method?: string; body?: string }> = [];
    vi.stubGlobal(
      "fetch",
      stubFetch((url, init) => {
        seen.push({ url, method: init?.method, body: typeof init?.body === "string" ? init.body : undefined });
        if (init?.method === "PUT") return jsonResponse({ path: "a b.txt" });
        return jsonResponse({ content: "hello", files: [{ path: "a b.txt" }] });
      }),
    );
    expect(await listWorkspaceFiles("ws 1")).toEqual([{ path: "a b.txt" }]);
    expect(await readWorkspaceFile("ws 1", "a b.txt")).toBe("hello");
    await saveWorkspaceFile("ws 1", "a b.txt", "body", true);
    await deleteWorkspaceFile("ws 1", "a b.txt");
    expect(seen[0]?.url).toContain("ws%201"); // list path encodes the workspace segment
    expect(seen[1]?.url).toContain("ws%201");
    expect(seen[1]?.url).toContain("path=a%20b.txt");
    expect(seen[2]?.url).toContain("ws%201"); // PUT path: file path travels in the body, not the URL
    expect(JSON.parse(seen[2]?.body ?? "{}")).toMatchObject({ path: "a b.txt" });
    expect(seen[3]?.url).toContain("ws%201");
    expect(seen[3]?.url).toContain("path=a%20b.txt");
    expect(seen[2]?.method).toBe("PUT");
    expect(JSON.parse(seen[2]?.body ?? "{}")).toEqual({ path: "a b.txt", content: "body", create_only: true });
    expect(seen[3]?.method).toBe("DELETE");
  });

  it("saveWorkspaceFile surfaces the server detail on failure", async () => {
    vi.stubGlobal("fetch", stubFetch(() => jsonResponse({ detail: "file exists" }, 409)));
    const err = await saveWorkspaceFile("ws", "f.txt", "x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("file exists");
    expect((err as ApiError).status).toBe(409);
  });

  it("shape-guards a malformed 200 column-logs payload instead of crashing the poller", async () => {
    vi.stubGlobal("fetch", stubFetch(() => jsonResponse({ workspace: 7, wire: "nope" })));
    const logs = await fetchColumnLogs("ws", "lane");
    expect(logs).toEqual({ workspace: "ws", label: "lane", events: [], wire: [], truncated: false });
    vi.stubGlobal("fetch", stubFetch(() => jsonResponse(null)));
    expect(await fetchColumnLogs("ws2", "lane2")).toEqual({
      workspace: "ws2",
      label: "lane2",
      events: [],
      wire: [],
      truncated: false,
    });
  });

  it("delivers ask_user answers and stops a single column", async () => {
    const seen: Array<{ url: string; body?: string }> = [];
    vi.stubGlobal(
      "fetch",
      stubFetch((url, init) => {
        seen.push({ url, body: String(init?.body) });
        return jsonResponse({ stopped: true });
      }),
    );
    await answerArenaQuestion("laneA", "q1", "because");
    await stopArenaColumn("laneA");
    expect(seen[0]?.url).toContain("/api/arena/answer");
    expect(JSON.parse(seen[0]?.body ?? "{}")).toEqual({ agent_id: "laneA", question_id: "q1", answer: "because" });
    expect(seen[1]?.url).toContain("/api/arena/stop-column");
    expect(JSON.parse(seen[1]?.body ?? "{}")).toEqual({ agent_id: "laneA" });
  });

  it("saves and loads runtime knobs through PUT/GET on the same path", async () => {
    const seen: Array<{ method?: string; body?: string }> = [];
    vi.stubGlobal(
      "fetch",
      stubFetch((_url, init) => {
        seen.push({ method: init?.method, body: typeof init?.body === "string" ? init.body : undefined });
        return jsonResponse({ knobs: { max_turns: 4 } });
      }),
    );
    expect(await saveRuntimeKnobs({ max_turns: 4 })).toEqual({ knobs: { max_turns: 4 } });
    expect(seen[0]?.method).toBe("PUT");
    expect(await fetchRuntimeKnobs()).toEqual({ knobs: { max_turns: 4 } });
    expect(seen[1]?.method).toBeUndefined(); // GET
  });

  it("loads and clears memory status", async () => {
    const seen: Array<{ url: string; method?: string }> = [];
    vi.stubGlobal(
      "fetch",
      stubFetch((url, init) => {
        seen.push({ url, method: init?.method });
        return jsonResponse({ episodic: 0, semantic: 0 });
      }),
    );
    expect(await fetchMemoryStatus()).toEqual({ episodic: 0, semantic: 0 });
    expect(await clearMemory()).toEqual({ episodic: 0, semantic: 0 });
    expect(seen[1]?.method).toBe("POST");
    expect(seen[1]?.url).toContain("/api/settings/memory/clear");
  });

  it("maps HTTP failures of GET endpoints to ApiError with the status", async () => {
    vi.stubGlobal("fetch", stubFetch(() => jsonResponse({ detail: "boom" }, 500)));
    for (const call of [fetchArenaMeta, fetchProvider, fetchRuntimeKnobs, fetchMemoryStatus, listProjects]) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(500);
    }
  });
});
