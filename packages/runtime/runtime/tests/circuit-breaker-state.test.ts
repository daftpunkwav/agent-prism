/**
 * @file circuit breaker state tests
 * @description Locks closed/open/half-open transitions and probe semantics.
 */

import { describe, expect, it } from "vitest";
import { CircuitBreaker } from "@agentprism/runtime";

/** Hand-cranked fake clock (milliseconds). */
function fakeClock() {
  let t = 1_000_000;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("CircuitBreaker state machine", () => {
  it("stays closed below threshold and allows requests", () => {
    const breaker = new CircuitBreaker(3, 30_000, () => 0);
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false);
    expect(breaker.state).toBe("closed");
  });

  it("opens at threshold and allows after cooldown (half-open)", () => {
    const clock = fakeClock();
    const breaker = new CircuitBreaker(3, 30_000, clock.now);
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
    expect(breaker.state).toBe("open");
    clock.advance(29_999);
    expect(breaker.isOpen()).toBe(true);
    clock.advance(1);
    expect(breaker.isOpen()).toBe(false);
    expect(breaker.state).toBe("half-open");
  });

  it("half-open probe failure restarts the open timer (regression: one-shot breaker bug)", () => {
    const clock = fakeClock();
    const breaker = new CircuitBreaker(3, 30_000, clock.now);
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    clock.advance(30_000);
    expect(breaker.isOpen()).toBe(false);
    breaker.recordFailure();
    // Probe failure must re-enter open with a fresh timer, not stay open forever on a stale openedAt
    expect(breaker.isOpen()).toBe(true);
    expect(breaker.state).toBe("open");
    clock.advance(30_000);
    expect(breaker.isOpen()).toBe(false);
  });

  it("half-open probe success restores closed", () => {
    const clock = fakeClock();
    const breaker = new CircuitBreaker(3, 30_000, clock.now);
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    clock.advance(30_000);
    breaker.recordSuccess();
    expect(breaker.state).toBe("closed");
    expect(breaker.isOpen()).toBe(false);
  });

  it("after success reset, failures must accumulate again before opening", () => {
    const breaker = new CircuitBreaker(3, 30_000, () => 0);
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false);
  });
});

