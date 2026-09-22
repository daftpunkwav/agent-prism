/**
 * @file assembly tools roster test
 * @description Locks the dynamic tool roster in the system prompt: rendered from
 * the actually-registered tool set, surviving a system-prompt override, and
 * omitted entirely for toolless runs.
 */
import { describe, expect, it } from "vitest";
import { PipelineConfigSchema } from "@agentprism/contracts";
import { RagStoreCache } from "../src/memory/rag.js";
import { MapToolRegistry } from "@agentprism/tool-registry";
import { TokenTracker } from "@agentprism/telemetry";
import { SystemClock } from "@agentprism/runtime";
import type { AgentExecutionContext } from "../src/execution-context.js";
import { buildSystemUser } from "../src/prompt/assembly.js";

function contextWith(tools: { names: string[]; systemPromptOverride?: string }): AgentExecutionContext {
  const base = PipelineConfigSchema.parse({ label: "col", harness: "bare" });
  return {
    identity: { agentId: "a", runId: "r" },
    config: base,
    question: "Do the task",
    history: [],
    turn: 1,
    workspace: {
      name: "ws",
      cwd: () => "/tmp/ws",
      fs: {
        readFile: () => {
          throw new Error("missing");
        },
        listFiles: () => [],
        exists: () => false,
      },
    } as unknown as AgentExecutionContext["workspace"],
    tracker: new TokenTracker({ contextWindow: 1000 }),
    clock: new SystemClock(),
    rag: new RagStoreCache(),
    llm: { invoke: async () => ({}) } as unknown as AgentExecutionContext["llm"],
    llmVendor: null,
    tools: {
      registry: new MapToolRegistry(),
      names: new Set(tools.names),
      execute: async () => ({ result: "", fileDiff: null, ok: true }),
    },
    systemPromptOverride: tools.systemPromptOverride,
  };
}

describe("buildSystemUser tool roster", () => {
  it("renders only the actually-registered tool names", () => {
    const { system } = buildSystemUser(contextWith({ names: ["read", "run"] }));
    expect(system).toContain("Available tools: read, run.");
    // The stale hardcoded roster must not leak back in.
    expect(system).not.toContain("apply_patch");
    expect(system).not.toContain("web_search");
  });

  it("keeps the roster after a custom system-prompt override", () => {
    const { system } = buildSystemUser(
      contextWith({ names: ["read"], systemPromptOverride: "You are a specialized writer." }),
    );
    expect(system).toContain("You are a specialized writer.");
    expect(system).toContain("Available tools: read.");
    expect(system).not.toContain("You are a coding agent inside a workspace.");
  });

  it("omits the roster entirely for toolless runs", () => {
    const { system } = buildSystemUser(contextWith({ names: [] }));
    expect(system).not.toContain("Available tools:");
  });
});
