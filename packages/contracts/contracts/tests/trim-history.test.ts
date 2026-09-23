/**
 * @file trim history tests
 * @description Locks the shared history-trim helper both session stores rely on.
 *
 * Responsibilities:
 * - Pin pair-bounded trimming: whole user/assistant pairs drop, alternation stays intact
 * - Pin the char accounting: tool rounds count toward the char cap with toolRoundChars
 * - Pin no-op behavior inside the caps
 */

import { describe, expect, it } from "vitest";
import { toolRoundChars, trimHistoryToCaps, type ToolRound } from "../src/index.js";

type Entry = { role: "user" | "assistant"; content: string; tool_rounds?: ToolRound[] };

function user(content: string): Entry {
  return { role: "user", content };
}

function assistant(content: string, toolRounds?: ToolRound[]): Entry {
  return { role: "assistant", content, ...(toolRounds !== undefined ? { tool_rounds: toolRounds } : {}) };
}

function round(result: string): ToolRound {
  return { tool: "read", args: {}, result };
}

describe("trimHistoryToCaps", () => {
  it("returns the history untouched while it fits the caps", () => {
    const history = [user("q1"), assistant("a1"), user("q2"), assistant("a2")];
    expect(trimHistoryToCaps(history, { maxMessages: 10, maxChars: 1000 })).toEqual(history);
  });

  it("drops whole oldest pairs until the message cap holds, keeping alternation", () => {
    const history = [user("q1"), assistant("a1"), user("q2"), assistant("a2"), user("q3"), assistant("a3")];
    const trimmed = trimHistoryToCaps(history, { maxMessages: 4, maxChars: 1000 });
    expect(trimmed).toEqual([user("q2"), assistant("a2"), user("q3"), assistant("a3")]);
    expect(trimmed[0]?.role).toBe("user");
    expect(trimmed.length % 2).toBe(0);
  });

  it("counts tool rounds toward the char cap with toolRoundChars accounting", () => {
    const big: ToolRound = round("x".repeat(300));
    const history = [user("q1"), assistant("a1", [big]), user("q2"), assistant("a2")];
    const roundChars = toolRoundChars(big);
    // A char cap between the rounds-free weight and the rounds-inclusive weight
    // must evict the first pair (the only one carrying rounds).
    const a1Weight = 2 + roundChars;
    const totalWeight = 2 + a1Weight + 2 + 2;
    const trimmed = trimHistoryToCaps(history, { maxMessages: 100, maxChars: totalWeight - 1 });
    expect(trimmed).toEqual([user("q2"), assistant("a2")]);
    // A cap above the total keeps everything.
    expect(trimHistoryToCaps(history, { maxMessages: 100, maxChars: totalWeight })).toEqual(history);
  });

  it("trims to empty when even the newest pair exceeds the char cap (no infinite loop)", () => {
    const huge: ToolRound = round("x".repeat(500));
    const history = [user("q1"), assistant("a1"), user("q2"), assistant("a2", [huge])];
    // Locked legacy store behavior: an impossible char cap evicts everything
    // (an empty history persists cleanly) instead of force-keeping a pair.
    expect(trimHistoryToCaps(history, { maxMessages: 100, maxChars: 10 })).toEqual([]);
  });

  it("handles an empty history", () => {
    expect(trimHistoryToCaps([], { maxMessages: 4, maxChars: 100 })).toEqual([]);
  });
});
