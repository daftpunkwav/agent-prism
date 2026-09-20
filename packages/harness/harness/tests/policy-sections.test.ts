/**
 * @file policy-sections test
 * @description Locks MCP/skill/orchestration prompt notes.
 */
import { describe, expect, it } from "vitest";
import { mcpPolicyNote, orchestrationNote, skillPolicyNote } from "../src/prompt/policy-sections.js";
import type { AgentExecutionContext } from "../src/execution-context.js";
import { buildSystemUser } from "../src/prompt/assembly.js";
import { PipelineConfigSchema } from "@agentprism/contracts";
import { RagStoreCache } from "../src/memory/rag.js";
import { TokenTracker } from "@agentprism/telemetry";
import { MapToolRegistry } from "@agentprism/tool-registry";
import { SystemClock } from "@agentprism/runtime";

function contextWith(config: Record<string, unknown>, preload = ""): AgentExecutionContext {
  const base = PipelineConfigSchema.parse({ label: "col", harness: "bare" });
  return {
    identity: { agentId: "a", runId: "r" },
    config: { ...base, ...config },
    question: "q",
    history: [],
    turn: 1,
    workspace: { name: "ws", cwd: () => "/tmp/ws", fs: {} } as unknown as AgentExecutionContext["workspace"],
    tracker: new TokenTracker({ contextWindow: 1000 }),
    clock: new SystemClock(),
    rag: new RagStoreCache(),
    llm: { invoke: async () => ({}) } as unknown as AgentExecutionContext["llm"],
    llmVendor: null,
    tools: { registry: new MapToolRegistry(), names: new Set(), execute: async () => ({ result: "", fileDiff: null, ok: true }) },
    skillPreloadBlock: preload,
  };
}

describe("policy notes", () => {
  it("renders only known policies", () => {
    expect(mcpPolicyNote("off")).toBe("");
    expect(mcpPolicyNote("fs")).toContain("mcp__fs_read");
    expect(mcpPolicyNote("full")).toContain("mcp__fetch_url");
    expect(skillPolicyNote("on_demand")).toBe("");
    expect(skillPolicyNote("off")).toContain("disabled");
    expect(orchestrationNote("direct")).toBe("");
    expect(orchestrationNote("plan_first")).toContain("plan");
  });

  it("buildSystemUser grounds MCP/skill/orchestration plus preloaded runbooks", () => {
    const ctx = contextWith({ mcp_policy: "full", skill_policy: "preloaded", orchestration: "plan_first" }, "## commit\nbody");
    const { system } = buildSystemUser(ctx);
    expect(system).toContain("MCP");
    expect(system).toContain("plan-first");
    expect(system).toContain("## commit");
  });

  it("preloaded block stays out unless the policy asks for it", () => {
    const ctx = contextWith({ skill_policy: "on_demand" }, "## commit\nbody");
    expect(buildSystemUser(ctx).system).not.toContain("## commit");
  });
});
