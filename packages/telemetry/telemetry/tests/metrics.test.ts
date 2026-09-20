/**
 * @file metrics tests
 * @description Locks hard-metric duration sanitization.
 *
 * Responsibilities:
 * - Pin non-finite/negative durations clamp to zero (never null in JSON)
 */

import { describe, expect, it } from "vitest";
import { buildMetrics } from "../src/metrics.js";
import { TokenTracker } from "../src/token.js";

function metricsFor(durationMs: number) {
  return buildMetrics(new TokenTracker({}), { success: true, durationMs, toolCalls: 0, steps: 0 });
}

describe("buildMetrics duration", () => {
  it("passes finite durations through rounded", () => {
    expect(metricsFor(123.6).duration_ms).toBe(124);
  });

  it("clamps NaN and negative durations to zero", () => {
    expect(metricsFor(NaN).duration_ms).toBe(0);
    expect(metricsFor(-50).duration_ms).toBe(0);
  });
});
