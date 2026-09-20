/**
 * @file step budget tests
 * @description Locks the shared step-budget gate, including the unlimited sentinel.
 *
 * Responsibilities:
 * - Pin turn-count exhaustion, the negative-sentinel bypass, and the absent-field default
 */
import { describe, expect, it } from "vitest";
import { stepBudgetExhausted, type AgentStateType } from "../src/graphs/state.js";

function stateWith(partial: Partial<AgentStateType>): AgentStateType {
  return partial as AgentStateType;
}

describe("stepBudgetExhausted", () => {
  it("ends once step_count reaches a positive max_steps", () => {
    expect(stepBudgetExhausted(stateWith({ step_count: 9, max_steps: 10 }))).toBe(false);
    expect(stepBudgetExhausted(stateWith({ step_count: 10, max_steps: 10 }))).toBe(true);
  });

  it("never exhausts while max_steps is the -1 unlimited sentinel", () => {
    expect(stepBudgetExhausted(stateWith({ step_count: 10_000, max_steps: -1 }))).toBe(false);
  });

  it("falls back to a budget of 10 when max_steps is absent", () => {
    expect(stepBudgetExhausted(stateWith({ step_count: 9 }))).toBe(false);
    expect(stepBudgetExhausted(stateWith({ step_count: 10 }))).toBe(true);
  });
});
