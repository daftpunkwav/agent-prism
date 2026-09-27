/**
 * @file context analytics tests
 * @description Covers the per-run context analytics seam.
 *
 * Responsibilities:
 * - Lock per-source usage recording and strategy observation bookkeeping
 * - Pin the report rendering entry
 */

import { describe, expect, it } from "vitest";
import type { LlmMessage } from "@agentprism/contracts";
import {
  createContextAnalytics,
  observeStrategy,
  recordPreparedUsage,
  summarizeAnalytics,
} from "../../src/context/analytics.js";

describe("context analytics bundle", () => {
  it("records per-source char-proxy usage over prepared messages", () => {
    const analytics = createContextAnalytics();
    const messages: LlmMessage[] = [
      { role: "system", content: "abcd" }, // 1 token at 4 chars/token
      { role: "user", content: "12345678" }, // 2 tokens
      { role: "tool", content: "xyz", toolCallId: "c1" }, // 1 token
    ];
    recordPreparedUsage(analytics, messages);
    recordPreparedUsage(analytics, [messages[0]!]);
    const aggregate = analytics.usage.aggregate();
    expect(aggregate.turns).toBe(2);
    expect(aggregate.bySource.system).toBe(2);
    expect(aggregate.bySource.history).toBe(2);
    expect(aggregate.bySource.tools).toBe(1);
    expect(aggregate.total).toBe(5);
    expect(aggregate.peak).toBe(4); // first turn dominates
  });

  it("observes strategy applications with kept/dropped tool-result counts", () => {
    const analytics = createContextAnalytics();
    const input: LlmMessage[] = [
      { role: "user", content: "abc" },
      { role: "tool", content: "r1", toolCallId: "c1" },
      { role: "tool", content: "r2", toolCallId: "c2" },
    ];
    observeStrategy(analytics, "sliding", input, [input[0]!], false);
    const report = summarizeAnalytics(analytics);
    expect(report.effectiveness).toContain("sliding");
    expect(report.usage).toContain("turn");
  });

  it("observes custom dimension ids on the same rows as builtins", () => {
    const analytics = createContextAnalytics();
    const input: LlmMessage[] = [{ role: "tool", content: "r1", toolCallId: "c1" }];
    observeStrategy(analytics, "custom_axis", input, [], true);
    const report = summarizeAnalytics(analytics).effectiveness;
    expect(report).toContain("custom_axis: n=1");
    expect(report).toContain("dropped_tools=1");
    expect(report).toContain("ledger=1.00");
  });
});
