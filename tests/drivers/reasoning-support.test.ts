/**
 * @file reasoning-support test
 * @description Locks the framework × reasoning support table against drift.
 */
import { describe, expect, it } from "vitest";
import { FrameworkDriverRegistry, registerDriversBestEffort } from "@agentprism/driver-run-support";
import { REASONING_SUPPORT, reasoningSupportFor } from "@agentprism/driver-run-support";

describe("REASONING_SUPPORT", () => {
  it("covers every registered driver with no spare entries", { timeout: 60000 }, async () => {
    const registry = new FrameworkDriverRegistry();
    await registerDriversBestEffort(registry, [
      { name: "Native", load: () => import("@agentprism/driver-native").then((m) => new m.NativeDriver()) },
      { name: "PlanExecute", load: () => import("@agentprism/driver-plan-execute").then((m) => new m.PlanExecuteDriver()) },
      { name: "SelfCritique", load: () => import("@agentprism/driver-self-critique").then((m) => new m.SelfCritiqueDriver()) },
      { name: "LangChain", load: () => import("@agentprism/driver-langchain").then((m) => new m.LangChainDriver()) },
      { name: "LangGraph", load: () => import("@agentprism/driver-langgraph").then((m) => new m.LangGraphDriver()) },
      { name: "AutoGen", load: () => import("@agentprism/driver-autogen").then((m) => new m.AutogenDriver()) },
      { name: "CrewAI", load: () => import("@agentprism/driver-crewai").then((m) => new m.CrewAIDriver()) },
      { name: "DeepAgents", load: () => import("@agentprism/driver-deepagents").then((m) => new m.DeepAgentsDriver()) },
      { name: "OpenAIAgents", load: () => import("@agentprism/driver-openai-agents").then((m) => new m.OpenAIAgentsDriver()) },
      { name: "ClaudeAgentSdk", load: () => import("@agentprism/driver-claude-agent-sdk").then((m) => new m.ClaudeAgentSdkDriver()) },
    ]);
    const ids = registry.listAvailable().map((driver) => driver.id).sort();
    expect(REASONING_SUPPORT.map((entry) => entry.frameworkId).sort()).toEqual(ids);
    for (const id of ids) {
      expect(reasoningSupportFor(id)?.level).toMatch(/^(structural|budget|prompt|skeleton)$/);
    }
    expect(reasoningSupportFor("langchain")?.modes).toEqual([]);
    expect(reasoningSupportFor("native")?.modes).toHaveLength(5);
  });
});
