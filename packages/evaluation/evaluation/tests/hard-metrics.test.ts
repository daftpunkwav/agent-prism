/**
 * @file hard metrics tests
 * @description Locks hard-metric row aggregation: null columns skipped, fields carried.
 */

import { describe, expect, it } from "vitest";
import { PipelineMetricsSchema } from "@agentprism/contracts";
import { buildHardMetrics } from "../src/report.js";

describe("buildHardMetrics", () => {
  it("carries metric fields into labeled rows", () => {
    const metrics = PipelineMetricsSchema.parse({
      success: true,
      duration_ms: 120,
      total_tokens: 300,
      tool_calls: 2,
      steps: 4,
    });
    const { rows } = buildHardMetrics({ col: metrics });
    expect(rows).toEqual([
      { label: "col", duration_ms: 120, total_tokens: 300, tool_calls: 2, steps: 4, success: true },
    ]);
  });

  it("skips null columns", () => {
    const metrics = PipelineMetricsSchema.parse({ success: false, duration_ms: 5 });
    const { rows } = buildHardMetrics({ a: null, b: metrics });
    expect(rows.map((row) => row.label)).toEqual(["b"]);
  });
});
