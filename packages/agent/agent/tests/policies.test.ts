/**
 * @file policies test
 * @description Locks MCP/skill/orchestration wiring in runAgentExecution.
 */
import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { PipelineConfigSchema } from "@agentprism/contracts";
import type { AgentExecutionContext } from "@agentprism/harness";
import { captureDriver, collect, terminalWorkspace, testDeps, testSpec } from "./run-fixtures.js";

describe("mcp policy wiring", () => {
  it("off exposes no mcp tools, fs/full do", async () => {
    for (const [policy, expected] of [["off", []], ["fs", ["mcp__fs_list", "mcp__fs_read"]]] as const) {
      const deps = testDeps();
      let seen: AgentExecutionContext | null = null;
      const spec = testSpec(captureDriver((ctx) => { seen = ctx; }), {
        config: PipelineConfigSchema.parse({ label: "col", harness: "bare", mcp_policy: policy }),
      });
      await collect(deps, spec);
      const names = [...(seen as unknown as AgentExecutionContext).tools.names].filter((n) => n.startsWith("mcp__")).sort();
      expect(names).toEqual(expected);
    }
  });

  it("full on the full toolset also bridges fetch", async () => {
    const deps = testDeps();
    let seen: AgentExecutionContext | null = null;
    const spec = testSpec(captureDriver((ctx) => { seen = ctx; }), {
      config: PipelineConfigSchema.parse({ label: "col", harness: "bare", mcp_policy: "full", toolset: "full" }),
    });
    await collect(deps, spec);
    const names = [...(seen as unknown as AgentExecutionContext).tools.names].filter((n) => n.startsWith("mcp__")).sort();
    expect(names).toEqual(["mcp__fetch_url", "mcp__fs_list", "mcp__fs_read"]);
  });

  it("carries the tuned fetch timeout into the bridged tool's declared budget", async () => {
    const deps = testDeps();
    let seen: AgentExecutionContext | null = null;
    const spec = testSpec(captureDriver((ctx) => { seen = ctx; }), {
      config: PipelineConfigSchema.parse({ label: "col", harness: "bare", mcp_policy: "full", toolset: "full" }),
      toolTuning: { mcpFetchTimeoutMs: 45_000 },
    });
    await collect(deps, spec);
    const fetchTool = (seen as unknown as AgentExecutionContext).tools.registry
      .listDefinitions()
      .find((definition) => definition.name === "mcp__fetch_url");
    // The registry arms its deadline from the declaration, so the operator knob
    // (MCP_FETCH_TIMEOUT_MS) must reach it instead of the module default.
    expect(fetchTool?.timeoutMs).toBe(45_000);
  });
});

describe("skill policy wiring", () => {
  it("off removes the skill tool, preloaded injects runbooks", async () => {
    const offDeps = testDeps();
    let offSeen: AgentExecutionContext | null = null;
    await collect(offDeps, testSpec(captureDriver((ctx) => { offSeen = ctx; }), {
      config: PipelineConfigSchema.parse({ label: "col", harness: "bare", skill_policy: "off" }),
    }));
    expect((offSeen as unknown as AgentExecutionContext).tools.names.has("skill")).toBe(false);
    expect((offSeen as unknown as AgentExecutionContext).skillPreloadBlock ?? "").toBe("");

    const preDeps = testDeps();
    let preSeen: AgentExecutionContext | null = null;
    await collect(preDeps, testSpec(captureDriver((ctx) => { preSeen = ctx; }), {
      config: PipelineConfigSchema.parse({ label: "col", harness: "bare", skill_policy: "preloaded" }),
    }));
    expect((preSeen as unknown as AgentExecutionContext).tools.names.has("skill")).toBe(true);
    expect((preSeen as unknown as AgentExecutionContext).skillPreloadBlock ?? "").toContain("## commit");
  });
});

describe("orchestration discipline", () => {
  it("stays prompt-only: plan_first and goal_first seed nothing into the workspace", async () => {
    for (const orchestration of ["plan_first", "goal_first"] as const) {
      const deps = testDeps();
      const spec = testSpec(captureDriver(() => {}), {
        config: PipelineConfigSchema.parse({ label: "col", harness: "bare", orchestration }),
      });
      const events = await collect(deps, spec);
      const workspaceName = terminalWorkspace(events, "complete");
      const runsRoot = (deps.workspaceRegistry as unknown as { runsRoot: string }).runsRoot;
      // A fresh column workspace starts empty: the discipline line lives in the
      // prompt, and .agent-plan.md / .agent-goal.json appear only when the agent
      // itself calls the plan/goal tools.
      expect(readdirSync(join(runsRoot, "r1", workspaceName))).toEqual([]);
    }
  });
});
