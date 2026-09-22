/**
 * @file projection test
 * @description Locks turn folding, preview budgets, and digests.
 */
import { describe, expect, it } from "vitest";
import type { ArenaEvent } from "@agentprism/contracts";
import { outlineDigest, outlineTurns } from "../src/projection.js";

function thought(turn: number, content: string): ArenaEvent {
  return { type: "thought", pipeline: "col", workspace: "ws", content, tool: "", args: {}, result: "", step: 1, passed: null, reason: "", metrics: null, message: "", token_stats: null, turn, runId: "r", timestamp: 1 } as unknown as ArenaEvent;
}

function action(turn: number, tool: string): ArenaEvent {
  return { ...thought(turn, ""), type: "action", tool, args: {} } as unknown as ArenaEvent;
}

describe("outlineTurns", () => {
  it("folds turns with previews, tools, and verdicts", () => {
    const events = [
      thought(1, "working on login"),
      action(1, "read"),
      action(1, "read"),
      action(1, "bash"),
      { ...thought(1, ""), type: "complete", metrics: { success: true } },
      thought(2, "x".repeat(500)),
    ] as unknown as ArenaEvent[];
    const outlines = outlineTurns(events, { 1: "Fix the login bug please", 2: "   " });
    expect(outlines).toHaveLength(2);
    expect(outlines[0]).toMatchObject({ turn: 1, prompt: "Fix the login bug please", tools: ["read", "bash"], verdict: "completed" });
    expect(outlines[0]!.response).toContain("working on login");
    expect(outlines[1]!.prompt).toBeNull();
    expect(outlines[1]!.response!.length).toBeLessThanOrEqual(240);
    expect(outlines[1]!.verdict).toBeNull();
  });

  it("collects unturned events under turn 0 and digests stably", () => {
    const outlines = outlineTurns([{ ...thought(0, "stray"), turn: -3 } as unknown as ArenaEvent]);
    expect(outlines).toHaveLength(1);
    expect(outlines[0]!.turn).toBe(0);
    expect(outlineDigest(outlines)).toEqual(["turn 0: open tools=[-] events=1"]);
    expect(outlineTurns([])).toEqual([]);
  });
});
