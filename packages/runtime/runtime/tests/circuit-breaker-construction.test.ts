/**
 * @file circuit breaker construction tests
 * @description Locks degenerate construction normalizing onto safe behavior.
 */

import { describe, expect, it } from "vitest";
import { CircuitBreaker } from "@agentprism/runtime";

describe("CircuitBreaker degenerate construction", () => {
  it("NaN or non-positive threshold normalizes to 1 (never starts open, never dead)", () => {
    for (const threshold of [NaN, 0, -3]) {
      const closed = new CircuitBreaker(threshold, 30_000, () => 0);
      expect(closed.isOpen()).toBe(false);
      closed.recordFailure();
      expect(closed.isOpen()).toBe(true);
    }
  });

  it("NaN cooldown normalizes to 0 (opens and half-opens immediately)", () => {
    const breaker = new CircuitBreaker(1, NaN, () => 0);
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false);
    expect(breaker.state).toBe("half-open");
  });
});
