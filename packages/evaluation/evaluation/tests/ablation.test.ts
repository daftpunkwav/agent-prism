/**
 * @file ablation test
 * @description Locks behavior-ablation rows and comparison summaries.
 */
import { describe, expect, it } from "vitest";
import type { ArenaEvent } from "@agentprism/contracts";
import { ablateColumn, ablateComparison, ablationSummary } from "../src/ablation.js";

function action(tool: string): ArenaEvent {
  return { type: "action", tool, args: {}, workspace: "ws" } as ArenaEvent;
}

function observation(result: string): ArenaEvent {
  return { type: "observation", result, workspace: "ws" } as ArenaEvent;
}

function reflect(content: string): ArenaEvent {
  return { type: "reflect", content, workspace: "ws" } as ArenaEvent;
}

function complete(success: boolean): ArenaEvent {
  return { type: "complete", metrics: { success }, workspace: "ws" } as ArenaEvent;
}

describe("ablateColumn", () => {
  it("profiles tool use, MCP share, skill reads, reflects, and observations", () => {
    const row = ablateColumn("col", {
      events: [
        action("read"),
        action("mcp__fs_read"),
        action("mcp__fetch_url"),
        action("skill"),
        action("subagent"),
        reflect("plan"),
        observation("x".repeat(100)),
        complete(true),
      ],
      answer: "done",
      judgePassed: true,
    });
    expect(row).toMatchObject({
      label: "col",
      tool_calls: 5,
      mcp_calls: 2,
      skill_reads: 1,
      delegations: 1,
      reflects: 1,
      observation_chars: 100,
      answer_chars: 4,
      judge_passed: true,
      success: true,
    });
    expect(row.mcp_share).toBeCloseTo(0.4);
  });

  it("stays honest on empty streams", () => {
    const row = ablateColumn("empty", { events: [] });
    expect(row).toMatchObject({ tool_calls: 0, mcp_share: 0, judge_passed: null, success: false });
  });
});

describe("ablateComparison", () => {
  it("sorts by label and summarizes judge deltas", () => {
    const rows = ablateComparison({
      b: { events: [complete(false)], answer: "no", judgePassed: false },
      a: { events: [action("read"), complete(true)], answer: "yes", judgePassed: true },
    });
    expect(rows.map((r) => r.label)).toEqual(["a", "b"]);
    const summary = ablationSummary(rows);
    expect(summary).toContain("judge: 1/2 columns passed");
    expect(summary).toContain("FAIL");
    expect(ablationSummary([])).toContain("no columns");
  });
});
