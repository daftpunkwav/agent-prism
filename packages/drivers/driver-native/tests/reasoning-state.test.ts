/**
 * @file reasoning-state test
 * @description Locks the native ToT branch loop: independent generate/score phases and argmax selection.
 */
import { describe, expect, it } from "vitest";
import type { LlmAssistantMessage } from "@agentprism/contracts";
import {
  afterLlm,
  createReasoningState,
  phaseHint,
  selectBestPlan,
  shouldBindTools,
} from "../src/reasoning-state.js";

function assistant(content: string): LlmAssistantMessage {
  return { role: "assistant", content, toolCalls: [] };
}

describe("native ToT branching", () => {
  it("loops branch→score for the configured width, then selects the argmax plan", () => {
    const state = createReasoningState("tot", { totWidth: 2 });
    expect(state.phase).toBe("think");
    expect(shouldBindTools(state)).toBe(false);
    expect(phaseHint(state)[0]?.content).toContain("branch 1/2");

    afterLlm(state, assistant("Plan A"), false);
    expect(state.phase).toBe("evaluate");
    expect(phaseHint(state)[0]?.content).toContain("score 1/2");
    expect(phaseHint(state)[0]?.content).toContain("Plan A");

    afterLlm(state, assistant("SCORE: 4 because"), false);
    expect(state.totRound).toBe(1);
    expect(state.phase).toBe("think");
    expect(phaseHint(state)[0]?.content).toContain("branch 2/2");

    afterLlm(state, assistant("Plan B"), false);
    afterLlm(state, assistant("SCORE: 9 solid"), false);
    expect(state.phase).toBe("act");
    expect(state.selectedPlan).toBe("Plan B");
    expect(state.scores).toEqual([4, 9]);
    // The execution phase binds tools again.
    expect(shouldBindTools(state)).toBe(true);
  });

  it("scores unparsable replies as 0 so the scored branch wins", () => {
    const state = createReasoningState("tot", { totWidth: 2 });
    afterLlm(state, assistant("Plan A"), false);
    afterLlm(state, assistant("looks fine to me"), false);
    afterLlm(state, assistant("Plan B"), false);
    afterLlm(state, assistant("SCORE: 1 weak"), false);
    expect(state.scores).toEqual([0, 1]);
    expect(state.selectedPlan).toBe("Plan B");
  });

  it("defaults to the width-3 sequence", () => {
    const state = createReasoningState("tot");
    expect(state.totWidth).toBe(3);
    for (let round = 0; round < 3; round += 1) {
      afterLlm(state, assistant(`Plan ${round}`), false);
      afterLlm(state, assistant("SCORE: 5"), false);
    }
    expect(state.phase).toBe("act");
  });

  it("breaks score ties toward the earliest branch", () => {
    expect(selectBestPlan(["a", "b", "c"], [5, 5, 5])).toBe(0);
    expect(selectBestPlan(["a", "b"], [5, 6])).toBe(1);
  });
});

describe("native non-tot modes stay on the old flow", () => {
  it("runs react straight to done without tool phases", () => {
    const state = createReasoningState("react");
    expect(state.phase).toBe("act");
    expect(shouldBindTools(state)).toBe(true);
    afterLlm(state, assistant("final answer"), false);
    expect(state.phase).toBe("done");
    expect(state.selectedPlan).toBe("");
  });

  it("gates cot_tool tool binding until the reasoning phase completes", () => {
    const state = createReasoningState("cot_tool");
    expect(shouldBindTools(state)).toBe(false);
    afterLlm(state, assistant("reasoning only"), false);
    expect(state.cotDone).toBe(true);
    expect(state.phase).toBe("act");
    expect(shouldBindTools(state)).toBe(true);
  });
});
