/**
 * @file remaining tests
 * @description Locks the context-budget reminder: threshold firing, purity,
 * and no-op behavior without a budget.
 *
 * Responsibilities:
 * - Pin token estimation and threshold semantics (ratio floor, cap at 100%)
 * - Pin purity (input never mutated) and single trailing reminder message
 * - Pin invalid-budget fail-open skip
 */

import { describe, expect, it } from "vitest";
import type { LlmMessage } from "@agentprism/contracts";
import { estimateContextTokens, maybeAppendContextReminder } from "../src/context/remaining.js";

function user(text: string): LlmMessage {
  return { role: "user", content: text };
}

describe("estimateContextTokens", () => {
  it("estimates ~4 chars per token and never returns zero", () => {
    expect(estimateContextTokens([user("x".repeat(400))])).toBe(100);
    expect(estimateContextTokens([user("")])).toBe(1);
  });
});

describe("maybeAppendContextReminder", () => {
  it("stays silent below the threshold", () => {
    const input = [user("x".repeat(400))];
    const result = maybeAppendContextReminder(input, { budgetTokens: 1000 });
    expect(result.reminderEmitted).toBe(false);
    expect(result.messages).toHaveLength(1);
  });

  it("fires one trailing system reminder at or above the threshold", () => {
    const input = [user("x".repeat(3400))];
    const result = maybeAppendContextReminder(input, { budgetTokens: 1000 });
    expect(result.reminderEmitted).toBe(true);
    expect(result.messages).toHaveLength(2);
    const reminder = result.messages[1]!;
    expect(reminder.role).toBe("system");
    expect(reminder.content).toContain("[Context budget]");
    expect(reminder.content).toContain("850 of 1000");
    expect(reminder.content).toContain("85%");
  });

  it("caps the reported percentage at 100 when over budget", () => {
    const result = maybeAppendContextReminder([user("x".repeat(8000))], { budgetTokens: 1000 });
    expect(result.messages[1]?.content).toContain("100%");
  });

  it("never mutates the input array", () => {
    const input = [user("x".repeat(900))];
    const snapshot = [...input];
    maybeAppendContextReminder(input, { budgetTokens: 1000 });
    expect(input).toEqual(snapshot);
  });

  it("skips invalid budgets (fail-open, no reminder)", () => {
    for (const budgetTokens of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = maybeAppendContextReminder([user("x".repeat(900))], { budgetTokens });
      expect(result.reminderEmitted, String(budgetTokens)).toBe(false);
    }
  });

  it("honors a custom threshold ratio", () => {
    const result = maybeAppendContextReminder([user("x".repeat(500))], { budgetTokens: 1000, thresholdRatio: 0.1 });
    expect(result.reminderEmitted).toBe(true);
  });
});
