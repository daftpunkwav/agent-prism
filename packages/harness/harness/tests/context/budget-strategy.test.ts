/**
 * @file budget strategy tests
 * @description Covers the "budget" context strategy's per-source allocation.
 *
 * Responsibilities:
 * - Pin the no-trim passthrough when the budget covers total demand
 * - Pin per-source shedding plus the allocation-ledger emission when it binds
 * - Pin the keep direction: the newest messages of an exhausted source survive
 */

import { describe, expect, it } from "vitest";
import type { LlmMessage } from "@agentprism/contracts";
import { applySourceBudget } from "../../src/context/budget-strategy.js";

function toolResult(content: string): LlmMessage {
  return { role: "tool", content, toolCallId: "c1" };
}

describe("applySourceBudget", () => {
  it("keeps every message when the budget covers total demand", () => {
    const messages: LlmMessage[] = [
      { role: "user", content: "question" },
      toolResult("result"),
      { role: "assistant", content: "answer" },
    ];
    const result = applySourceBudget(messages, { budgetTokens: 10_000 });
    expect(result.messages).toEqual(messages);
    expect(result.ledgerEmitted).toBe(false);
  });

  it("sheds over-budget sources and renders the ledger the model can see", () => {
    const messages: LlmMessage[] = [
      { role: "user", content: "old-1" },
      { role: "user", content: "old-2" },
      { role: "user", content: "newest" },
      toolResult("old-tool"),
      toolResult("new-tool"),
    ];
    // Tiny budget: demand (16 chars as 1 char/token per source) far exceeds it.
    const result = applySourceBudget(messages, { budgetTokens: 6, charsPerToken: 1 });
    expect(result.ledgerEmitted).toBe(true);
    const kept = result.messages.slice(0, -1);
    for (const message of kept) {
      expect(messages).toContainEqual(message); // only real input messages survive
    }
    expect(kept.length).toBeLessThan(messages.length); // something was shed
    const ledger = result.messages.at(-1);
    expect(ledger?.role).toBe("system");
    expect(String(ledger?.content)).toContain("[Budget ledger]");
  });

  it("drops an oversized single message entirely instead of clipping it", () => {
    const messages: LlmMessage[] = [{ role: "user", content: "x".repeat(500) }];
    const result = applySourceBudget(messages, { budgetTokens: 4, charsPerToken: 1 });
    const kept = result.messages.filter((m) => m.role !== "system");
    expect(kept).toHaveLength(0);
    expect(result.ledgerEmitted).toBe(true);
  });

  it("keeps the newest messages of an exhausted source and sheds the oldest", () => {
    const messages: LlmMessage[] = [
      { role: "user", content: "old-1" },
      { role: "user", content: "old-2" },
      { role: "user", content: "newest" },
    ];
    // 16 estimated tokens of history demand against a 6-token budget: the
    // granted history allowance covers only the newest 6-token turn, so the
    // two stale heads must drop — not the live tail.
    const result = applySourceBudget(messages, { budgetTokens: 6, charsPerToken: 1 });
    expect(result.messages.filter((m) => m.role !== "system")).toEqual([{ role: "user", content: "newest" }]);
    expect(result.ledgerEmitted).toBe(true);
  });
});
