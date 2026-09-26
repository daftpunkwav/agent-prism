/**
 * @file driver banner consistency tests
 * @description Keeps frameworkIds consistent with the banner map.
 *
 * Responsibilities:
 * - Check every driver frameworkId has exactly one banner mapping
 */

import { describe, expect, it } from "vitest";
import { PIPELINE_BANNER_FRAMEWORK_IDS } from "@agentprism/contracts";
import { FrameworkDriverRegistry, registerDriversBestEffort } from "@agentprism/driver-run-support";

/**
 * Cross-package literal contract: isForeignPipelineConfigBanner looks up by
 * frameworkId. Renaming a driver's frameworkId without updating the banner map
 * would silently disable foreign-banner detection — this test fails the rename in CI.
 *
 * Backend leaves are journey-level imports through public barrels only (no
 * runtime coupling); registration mirrors the composition root's builtin loader
 * list in apps/server.
 */
describe("driver frameworkId ↔ banner map consistency", () => {
  // Builtin registration pulls the langchain import chain; cold CI/import can exceed the 5s default timeout.
  it("every registered driver's frameworkId has a banner mapping, with no spare keys", { timeout: 60000 }, async () => {
    const registry = new FrameworkDriverRegistry();
    await registerDriversBestEffort(registry, [
      { name: "Native", load: () => import("@agentprism/driver-native").then((m) => new m.NativeDriver()) },
      {
        name: "PlanExecute",
        load: () => import("@agentprism/driver-plan-execute").then((m) => new m.PlanExecuteDriver()),
      },
      {
        name: "SelfCritique",
        load: () => import("@agentprism/driver-self-critique").then((m) => new m.SelfCritiqueDriver()),
      },
      {
        name: "LangChain",
        load: () => import("@agentprism/driver-langchain").then((m) => new m.LangChainDriver()),
      },
      {
        name: "LangGraph",
        load: () => import("@agentprism/driver-langgraph").then((m) => new m.LangGraphDriver()),
      },
      {
        name: "AutoGen",
        load: () => import("@agentprism/driver-autogen").then((m) => new m.AutogenDriver()),
      },
      {
        name: "CrewAI",
        load: () => import("@agentprism/driver-crewai").then((m) => new m.CrewAIDriver()),
      },
      {
        name: "DeepAgents",
        load: () => import("@agentprism/driver-deepagents").then((m) => new m.DeepAgentsDriver()),
      },
      {
        name: "OpenAIAgents",
        load: () => import("@agentprism/driver-openai-agents").then((m) => new m.OpenAIAgentsDriver()),
      },
      {
        name: "ClaudeAgentSdk",
        load: () => import("@agentprism/driver-claude-agent-sdk").then((m) => new m.ClaudeAgentSdkDriver()),
      },
    ]);
    const frameworkIds = registry.listAvailable().map((framework) => framework.id);

    expect(frameworkIds.length, "at least one driver must register or this contract cannot lock").toBeGreaterThan(0);
    for (const id of frameworkIds) {
      expect(
        PIPELINE_BANNER_FRAMEWORK_IDS,
        `driver frameworkId "${id}" lacks a banner mapping; foreign-banner detection would silently fail`,
      ).toContain(id);
    }
    expect(PIPELINE_BANNER_FRAMEWORK_IDS, "banner map has spare keys with no matching driver").toHaveLength(frameworkIds.length);
  });
});
