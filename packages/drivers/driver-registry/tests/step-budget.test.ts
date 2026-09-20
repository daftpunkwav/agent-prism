/**
 * @file step budget tests
 * @description Locks the max_steps → driver turn-cap derivation, including the unlimited sentinel.
 *
 * Responsibilities:
 * - Pin the positive-integer clamp, the negative-sentinel unbounded cap, and the NaN fallback
 */
import { describe, expect, it } from "vitest";
import { stepBudgetFor } from "../src/step-budget.js";

describe("stepBudgetFor", () => {
  it("clamps finite budgets to at least one turn", () => {
    expect(stepBudgetFor(10)).toBe(10);
    expect(stepBudgetFor(0)).toBe(1);
    expect(stepBudgetFor(2.7)).toBe(2);
  });

  it("maps the -1 unlimited sentinel to an unbounded cap", () => {
    expect(stepBudgetFor(-1)).toBe(Number.POSITIVE_INFINITY);
    expect(stepBudgetFor(-7)).toBe(Number.POSITIVE_INFINITY);
  });

  it("never returns a cap that skips the loop outright", () => {
    expect(stepBudgetFor(Number.NaN)).toBe(1);
    expect(stepBudgetFor(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
