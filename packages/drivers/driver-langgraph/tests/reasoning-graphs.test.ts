/**
 * @file reasoning-graphs tests
 * @description Locks reasoning-mode dispatch and the ToT branching graph shape.
 *
 * Responsibilities:
 * - Pin fail-closed dispatch: unknown modes throw instead of silently running react
 * - Pin the ToT argmax selection and the dynamic branch chain compilation
 */

import { describe, expect, it } from "vitest";
import { HumanMessage } from "@langchain/core/messages";
import { createContextAnalytics } from "@agentprism/harness";
import { buildReasoningGraph } from "../src/reasoning-graphs.js";
import { buildTotGraph, selectBestCandidate } from "../src/graphs/tot.js";
import { llmMessages, type AgentStateType, type ReasoningGraphDeps } from "../src/graphs/state.js";

describe("buildReasoningGraph", () => {
  it("throws on unknown reasoning modes instead of silently running react", () => {
    expect(() => buildReasoningGraph("nonsense" as never, {} as never)).toThrow(/Unknown reasoning mode/);
  });

  it("compiles the tot branch chain for the requested width", () => {
    const compiled = buildTotGraph({} as never, 2).compile();
    const nodeNames = Object.keys(compiled.getGraph().nodes);
    for (const name of ["branch_1", "score_1", "branch_2", "score_2", "select", "act", "execute"]) {
      expect(nodeNames).toContain(name);
    }
    expect(nodeNames).not.toContain("branch_3");
  });
});

describe("selectBestCandidate", () => {
  it("picks the argmax branch and breaks ties toward the earliest", () => {
    expect(selectBestCandidate([{ plan: "a", score: 3 }, { plan: "b", score: 9 }])).toBe(1);
    expect(selectBestCandidate([{ plan: "a", score: 5 }, { plan: "b", score: 5 }])).toBe(0);
    expect(selectBestCandidate([])).toBe(0);
  });
});

describe("graph context analytics", () => {
  it("forwards the run's analytics into the shared context pipeline", () => {
    // The seam the driver wires from the execution context: without it, every
    // graph column reports "no turns recorded" in the strategy-effectiveness log.
    const analytics = createContextAnalytics();
    const state = {
      messages: [new HumanMessage("do the task")],
      step_count: 0,
      max_steps: 10,
      tool_calls: 0,
      reflections: [],
      context_strategy: "sliding",
      candidates: [],
    } as unknown as AgentStateType;
    const deps = {
      retrieveSnippets: () => "",
      contextAnalytics: analytics,
    } as unknown as ReasoningGraphDeps;

    const prepared = llmMessages(state, deps);

    expect(prepared.length).toBeGreaterThan(0);
    expect(analytics.usage.size).toBe(1);
    expect(analytics.effectiveness.size).toBe(1);
  });
});
