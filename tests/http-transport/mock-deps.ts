/**
 * @file mock deps
 * @description Shared HTTP-application doubles for the transport journey tests.
 *
 * Responsibilities:
 * - Build inert service mocks with observable route collaborators
 * - Provide stateful knob and memory doubles for the settings routes
 *
 * Support module, not a test: picked up by no runner (no .test suffix).
 */

import { vi } from "vitest";
import { FileThreadStore, SessionService, ThreadService, type ArenaService } from "@agentprism/application";
import { InMemorySessionStore } from "@agentprism/session";
import { AtomicJsonFile } from "@agentprism/persistence";
import { createHttpApplication, type HttpApplicationDeps, type HttpApp } from "@agentprism/http-runtime";
import { registerArenaRoutes } from "@agentprism/route-arena";
import { registerBuilderRoutes } from "@agentprism/route-builder";
import { registerProjectRoutes } from "@agentprism/route-projects";
import { registerProviderRoutes } from "@agentprism/route-provider";
import { registerSettingsRoutes } from "@agentprism/route-settings";
import { registerWorkspaceRoutes } from "@agentprism/route-workspace";
import { registerSessionRoutes } from "@agentprism/route-sessions";
import { registerThreadRoutes } from "@agentprism/route-threads";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** Durable-thread service over a throwaway store; the arena double stays inert. */
export function mockThreadService(arena: ArenaService = { run: vi.fn() } as unknown as ArenaService): ThreadService {
  const filePath = join(mkdtempSync(join(tmpdir(), "thread-transport-")), `${randomUUID()}.json`);
  return new ThreadService({
    threads: new FileThreadStore({
      file: new AtomicJsonFile(filePath),
      idGenerator: { next: () => Math.random().toString(16).slice(2, 14).padEnd(12, "0") },
      clock: { now: () => 1700000000000 },
    }),
    arena,
    workspaceRegistry: { protectedCount: () => 0, clone: () => Promise.resolve(undefined), pin: () => undefined, unpin: () => undefined },
    clock: { now: () => 1700000000000 },
  });
}

/** Stateful runtime-knob double: merges updates so a PUT is observable through the next GET. */
export function mockRuntimeKnobs() {
  let knobs: Record<string, unknown> = { contextWindowMessages: 12 };
  return {
    current: () => knobs,
    fields: () => [{ key: "contextWindowMessages", group: "context", kind: "number" }],
    update: async (raw: unknown) => {
      knobs = { ...knobs, ...(raw as Record<string, unknown>) };
      return knobs;
    },
  } as any;
}

/** Stateful memory-status double: clear() zeroes both counters. */
export function mockMemoryStatus() {
  let episodicCount = 2;
  let semanticCount = 3;
  return {
    status: () => ({
      episodicCount,
      semanticCount,
      episodicPath: "data/memory_episodic.json",
      semanticPath: "data/memory_semantic.json",
    }),
    clear: () => {
      episodicCount = 0;
      semanticCount = 0;
    },
  } as any;
}

/**
 * Stateful skill-store double mirroring the real message-based error contract:
 * "bundled skills are read-only" (409) and "already exists" (409) sentinels,
 * everything else a plain defect (400).
 */
export function mockSkills() {
  const skills: Array<{ name: string; description: string; source: string; enabled: boolean }> = [
    { name: "bundled-a", description: "bundled", source: "bundled", enabled: true },
    { name: "user-a", description: "user", source: "user", enabled: true },
  ];
  return {
    list: () => skills.map((skill) => ({ ...skill })),
    create: (input: { name: string; description: string; body: string }) => {
      const name = input.name.trim();
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error("name must be kebab-case (lowercase letters, digits, dashes)");
      if (skills.some((skill) => skill.name === name)) throw new Error(`skill ${JSON.stringify(name)} already exists`);
      skills.push({ name, description: input.description, source: "user", enabled: true });
      return { name };
    },
    update: (name: string, patch: { description?: string; body?: string }) => {
      if (name === "bundled-a") throw new Error("bundled skills are read-only");
      const skill = skills.find((entry) => entry.name === name);
      if (skill === undefined) throw new Error(`unknown user skill ${JSON.stringify(name)}`);
      if (patch.description !== undefined) skill.description = patch.description;
      return { name };
    },
    remove: (name: string) => {
      if (name === "bundled-a") throw new Error("bundled skills are read-only");
      const index = skills.findIndex((entry) => entry.name === name);
      if (index < 0) throw new Error(`unknown user skill ${JSON.stringify(name)}`);
      skills.splice(index, 1);
    },
    setEnabled: (name: string, enabled: boolean) => {
      const skill = skills.find((entry) => entry.name === name);
      if (skill === undefined) throw new Error(`unknown user skill ${JSON.stringify(name)}`);
      skill.enabled = enabled;
    },
  } as any;
}

/** Stateful MCP double: full-list replace with parser-shaped validation. */
export function mockMcp() {
  let servers: Array<Record<string, unknown>> = [{ command: "npx", args: ["-y", "demo"], enabled: true }];
  return {
    list: () => servers.map((server) => ({ ...server })),
    replace: (input: unknown) => {
      if (!Array.isArray(input)) throw new Error("MCP_SERVERS must be a JSON array of server configs");
      for (const entry of input) {
        const record = entry as Record<string, unknown>;
        if (typeof record.command !== "string" || record.command.trim() === "") {
          throw new Error("MCP_SERVERS[0].command must be a non-empty string");
        }
      }
      servers = input.map((entry) => ({ ...(entry as Record<string, unknown>) }));
      return servers.map((server) => ({ ...server }));
    },
  } as any;
}

/** Minimal mock deps covering every route under test. */
export function mockDeps(overrides: Partial<HttpApplicationDeps> = {}): HttpApplicationDeps {
  return {
    settings: {
      corsOrigins: "",
      frontendPort: 3000,
      apiToken: "",
      maxRequestSize: 10 * 1024 * 1024,
      backendHost: "127.0.0.1",
      backendPort: 8281,
      maxConcurrentRuns: 2,
    } as any,
    arena: {
      getMeta: vi.fn().mockResolvedValue({ dimensions: [], frameworks: [], baseline_defaults: {}, baseline_fields: [], model_compare_ready: false }),
      run: vi.fn(),
      listTemplates: vi.fn().mockReturnValue([]),
      judge: vi.fn().mockReturnValue({ template_id: "t", template_name: "T", judge_type: "keyword", results: {} }),
    } as any,
    arenaLogs: {
      columnLogs: vi.fn().mockReturnValue({ workspace: "ws", label: "lane", events: [], wire: [], truncated: false }),
    } as any,
    matrix: {
      runMatrix: vi.fn(),
    } as any,
    providers: {
      getProvider: vi.fn().mockReturnValue({}),
      saveProvider: vi.fn().mockReturnValue({}),
      testProvider: vi.fn().mockResolvedValue({ ok: true, message: "ok" }),
    } as any,
    workspaces: {
      listFiles: vi.fn().mockReturnValue([]),
      readFile: vi.fn().mockReturnValue({ path: "f.txt", content: "x" }),
      writeFile: vi.fn().mockReturnValue({ path: "f.txt" }),
      deleteFile: vi.fn().mockReturnValue({ deleted: "f.txt" }),
    } as any,
    projects: {
      listProjects: vi.fn().mockReturnValue([]),
      createFromRun: vi.fn().mockReturnValue({ id: "p1" }),
      deleteProject: vi.fn().mockReturnValue(true),
    } as any,
    builder: {
      catalog: vi.fn().mockReturnValue({}),
      createSession: vi.fn(),
      listSessions: vi.fn().mockReturnValue([]),
    } as any,
    sessions: mockSessionService(),
    threads: mockThreadService(),
    runtimeKnobs: mockRuntimeKnobs(),
    memoryStatus: mockMemoryStatus(),
    skills: mockSkills(),
    mcp: mockMcp(),
    clock: { now: () => 1700000000000 },
    ...overrides,
  };
}


/**
 * Builds the fully composed test app: shell + every route leaf, mirroring the
 * composition root in apps/server. Journey tests must use this (never a
 * bare shell) so route coverage cannot silently drop.
 */
export function buildTestApp(overrides: Partial<HttpApplicationDeps> = {}): HttpApp {
  const deps = mockDeps(overrides);
  const app = createHttpApplication(deps);
  registerProviderRoutes(app, deps);
  registerSettingsRoutes(app, deps);
  registerArenaRoutes(app, deps);
  registerWorkspaceRoutes(app, deps);
  registerProjectRoutes(app, deps);
  registerBuilderRoutes(app, deps);
  registerSessionRoutes(app, deps);
  registerThreadRoutes(app, deps);
  return app;
}

/** Ephemeral session ledger shared by journey tests (reseeded per mockDeps call). */
export function mockSessionService(): SessionService {
  let seq = 0;
  return new SessionService({
    store: new InMemorySessionStore({ idGenerator: { next: () => `ses-${++seq}` }, clock: { now: () => 1700000000000 } }),
  });
}
