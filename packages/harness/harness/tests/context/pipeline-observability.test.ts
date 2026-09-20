/**
 * @file context pipeline observability tests
 * @description Covers applyContextPipeline options: fail-closed strategies, analytics recording, reminder.
 *
 * Responsibilities:
 * - Lock unknown-strategy rejection
 * - Pin per-source usage + strategy observation recording when analytics is wired
 * - Pin the wrap-up reminder append once the estimated usage crosses the budget
 */

import { describe, expect, it } from "vitest";
import type { LlmMessage } from "@agentprism/contracts";
import { applyContextPipeline } from "../../src/context/pipeline.js";
import { createContextAnalytics } from "../../src/context/analytics.js";

describe("applyContextPipeline options", () => {
  it("fails closed on unknown strategy ids", () => {
    expect(() => applyContextPipeline([], "mystery")).toThrow(/mystery/);
  });

  it("records prepared usage and strategy observations when analytics is wired", () => {
    const analytics = createContextAnalytics();
    const messages: LlmMessage[] = [
      { role: "system", content: "s" },
      { role: "user", content: "question text" },
      { role: "tool", content: "tool result", toolCallId: "c1" },
    ];
    const out = applyContextPipeline(messages, "sliding", { analytics });
    expect(out.length).toBeGreaterThan(0);
    expect(analytics.usage.aggregate().turns).toBe(1);
    const report = analytics.effectiveness.effectiveness();
    expect(report.length).toBeGreaterThan(0);
  });

  it("skips sanitize+grounding only when explicitly disabled", () => {
    const messages: LlmMessage[] = [{ role: "user", content: "hello" }];
    expect(applyContextPipeline(messages, "sliding", { sanitizeAndGround: false })).toEqual(messages);
    // Default path keeps the message but runs it through sanitize/grounding (no-op on clean text).
    expect(applyContextPipeline(messages, "sliding")).toEqual(messages);
  });

  it("appends a wrap-up reminder when the estimated usage crosses the budget threshold", () => {
    const long: LlmMessage[] = [{ role: "user", content: "x".repeat(400) }];
    const reminded = applyContextPipeline(long, "sliding", {
      sanitizeAndGround: false,
      contextBudgetTokens: 50, // 400 chars ≈ 100 tokens > 85% of 50
      charsPerToken: 4,
    });
    const last = reminded.at(-1);
    expect(reminded.length).toBe(2);
    expect(last?.role).toBe("system");
    expect(String(last?.content)).toContain("Context budget");

    const quiet = applyContextPipeline(long, "sliding", {
      sanitizeAndGround: false,
      contextBudgetTokens: 100_000,
      charsPerToken: 4,
    });
    expect(quiet).toHaveLength(1); // below threshold: no reminder
  });
});
