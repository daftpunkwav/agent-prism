/**
 * @file recursion limit tests
 * @description Locks the max_steps → graph recursion_limit derivation, including the unlimited sentinel.
 *
 * Responsibilities:
 * - Pin the 5x/floor-50 scaling, the negative-sentinel ceiling, and the NaN fallback
 */
import { describe, expect, it } from "vitest";
import { UNBOUNDED_RECURSION_LIMIT, recursionLimitFor } from "../src/recursion-limit.js";

describe("recursionLimitFor", () => {
  it("scales finite budgets 5x with a floor of 50", () => {
    expect(recursionLimitFor(10)).toBe(50);
    expect(recursionLimitFor(20)).toBe(100);
    expect(recursionLimitFor(1)).toBe(50);
  });

  it("maps the -1 unlimited sentinel to the unbounded ceiling", () => {
    expect(recursionLimitFor(-1)).toBe(UNBOUNDED_RECURSION_LIMIT);
  });

  it("never hands the graph a non-finite limit", () => {
    expect(recursionLimitFor(Number.NaN)).toBe(50);
    expect(recursionLimitFor(Number.POSITIVE_INFINITY)).toBe(50);
  });
});
