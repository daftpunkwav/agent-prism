/**
 * @file deepagents filesystem containment test
 * @description Pins that the framework's own filesystem tools stay inside the Arena workspace.
 *
 * Responsibilities:
 * - Capture the backend the driver hands to createFilesystemMiddleware
 * - Assert paths outside the workspace root are rejected while in-workspace ones resolve
 *
 * The framework tools run outside the registry, so tools.execute's guards never see
 * them; root containment is the only boundary they have. A backend built without
 * containment accepts any absolute path (e.g. C:/Windows/win.ini) and resolves
 * relative ones against the host process cwd, escaping the column's workspace.
 */

import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArenaEvent, PipelineConfig } from "@agentprism/contracts";
import { PipelineConfigSchema } from "@agentprism/contracts";
import type { AgentExecutionContext } from "@agentprism/harness";
import { WorkspaceRegistry } from "@agentprism/runtime";
import { TokenTracker } from "@agentprism/telemetry";
import { createBuiltinToolRegistry } from "@agentprism/tool-builtins";
import { DeepAgentsDriver } from "../src/deepagents-driver.js";

/** Middleware options captured from the driver's own call. */
const captured = vi.hoisted(() => [] as Array<Record<string, unknown>>);

// Wrap (not replace) the factory: the driver's call is recorded and the real
// middleware is still built, so the assertion reads the wiring under test.
vi.mock("deepagents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("deepagents")>();
  return {
    ...actual,
    createFilesystemMiddleware: (options: Record<string, unknown>) => {
      captured.push(options);
      return actual.createFilesystemMiddleware(options as never);
    },
  };
});

/** Model stub: reaches middleware construction, then fails the graph run (the capture already happened). */
const explodingModel = {
  getName: () => "exploding",
  invoke: async () => {
    throw new Error("model exploded");
  },
  stream: async function* () {
    throw new Error("model exploded");
  },
};

/** Real workspace under a throwaway runs root (buildSystemUser reads cwd/fs). */
function executionContext(): AgentExecutionContext & { cleanup: () => void } {
  const registry = createBuiltinToolRegistry();
  const config: PipelineConfig = PipelineConfigSchema.parse({ label: "col", harness: "bare" });
  const runsRoot = mkdtempSync(join(tmpdir(), "deepagents-fs-"));
  const workspace = new WorkspaceRegistry({ runsRoot, clock: { now: () => 1_700_000_000_000 } }).create("ws");
  const context = {
    identity: { agentId: "a1" } as AgentExecutionContext["identity"],
    config,
    question: "What is 2+2?",
    history: [],
    turn: 1,
    workspace,
    tracker: new TokenTracker(),
    clock: { now: () => 1_700_000_000_000 },
    rag: {} as AgentExecutionContext["rag"],
    llm: {} as AgentExecutionContext["llm"],
    llmVendor: explodingModel,
    tools: {
      registry,
      names: new Set(registry.listDefinitions().map((definition) => definition.name)),
      execute: async () => ({ result: "ok", fileDiff: null, ok: true }),
    },
  } as unknown as AgentExecutionContext & { cleanup: () => void };
  context.cleanup = () => rmSync(runsRoot, { recursive: true, force: true });
  return context;
}

describe("deepagents filesystem containment", () => {
  it("confines the framework's filesystem tools to the Arena workspace", { timeout: 60_000 }, async () => {
    const driver = new DeepAgentsDriver();
    const context = executionContext();
    try {
      const events: ArenaEvent[] = [];
      for await (const event of driver.run(context)) events.push(event);
      // The stub model fails the run; the middleware was built before it ran.
      expect(events.some((event) => event.type === "error")).toBe(true);

      // The last capture: a retried attempt appends to the same array.
      const backend = captured.at(-1)?.backend as { resolvePath(path: string): string };
      expect(backend).toBeDefined();
      // An absolute path outside the workspace (here: the runs root's parent) must be
      // rejected; without root containment it is returned verbatim and the framework's
      // read_file serves whatever it points at.
      expect(() => backend.resolvePath(tmpdir())).toThrow();
      expect(() => backend.resolvePath(join(tmpdir(), "..", "system-file"))).toThrow();
      // In-workspace access still works, so the column keeps its filesystem tools.
      expect(backend.resolvePath("notes.txt")).toBe(join(context.workspace.cwd(), "notes.txt"));
    } finally {
      context.cleanup();
    }
  });
});
