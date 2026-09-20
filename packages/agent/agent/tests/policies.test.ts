/**
 * @file policies test
 * @description Locks MCP/skill/orchestration wiring in runAgentExecution.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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

describe("orchestration seeding", () => {
  it("plan_first seeds a plan doc, goal_first seeds a goal doc", async () => {
    const planDeps = testDeps();
    const planSpec = testSpec(captureDriver(() => {}), {
      config: PipelineConfigSchema.parse({ label: "col", harness: "bare", orchestration: "plan_first" }),
    });
    const planEvents = await collect(planDeps, planSpec);
    const planWs = terminalWorkspace(planEvents, "complete");
    const planRoot = (planDeps.workspaceRegistry as unknown as { runsRoot: string }).runsRoot;
    expect(readFileSync(join(planRoot, "r1", planWs, ".agent-plan.md"), "utf-8")).toContain("# Plan");

    const goalDeps = testDeps();
    const goalSpec = testSpec(captureDriver(() => {}), {
      config: PipelineConfigSchema.parse({ label: "col", harness: "bare", orchestration: "goal_first" }),
    });
    const goalEvents = await collect(goalDeps, goalSpec);
    const goalWs = terminalWorkspace(goalEvents, "complete");
    const goalRoot = (goalDeps.workspaceRegistry as unknown as { runsRoot: string }).runsRoot;
    expect(readFileSync(join(goalRoot, "r1", goalWs, ".agent-goal.json"), "utf-8")).toContain("active");
  });
});
