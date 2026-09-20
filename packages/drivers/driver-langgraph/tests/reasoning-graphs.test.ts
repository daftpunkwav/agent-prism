/**
 * @file reasoning-graphs tests
 * @description Locks reasoning-mode dispatch and the ToT branching graph shape.
 *
 * Responsibilities:
 * - Pin fail-closed dispatch: unknown modes throw instead of silently running react
 * - Pin the ToT argmax selection and the dynamic branch chain compilation
 */

import { describe, expect, it } from "vitest";
import { buildReasoningGraph } from "../src/reasoning-graphs.js";
import { buildTotGraph, selectBestCandidate } from "../src/graphs/tot.js";

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
