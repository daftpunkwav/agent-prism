/**
 * @file phase-groups tests
 * @description Locks phase folding: categories, consecutive merges, counts, durations.
 */
import { describe, expect, it } from "vitest";
import type { ArenaEvent } from "@agentprism/contracts";
import { classifyTool, groupPhases, mergeEvents } from "../src/index.js";

function ev(partial: Partial<ArenaEvent> & { type: ArenaEvent["type"] }): ArenaEvent {
  return {
    pipeline: "col",
    workspace: "",
    content: "",
    tool: "",
    args: {},
    result: "",
    step: 1,
    passed: null,
    reason: "",
    metrics: null,
    message: "",
    token_stats: null,
    turn: 1,
    runId: "",
    timestamp: 0,
    ...partial,
  } as ArenaEvent;
}

describe("groupPhases", () => {
  it("folds consecutive tool segments of the same category with per-tool counts", () => {
    const events: ArenaEvent[] = [
      ev({ type: "thought", content: "plan" }),
      ev({ type: "action", tool: "web_search", args: { q: "mario" } }),
      ev({ type: "observation", tool: "web_search", result: "hits" }),
      ev({ type: "action", tool: "read", args: { path: "a.js" } }),
      ev({ type: "observation", tool: "read", result: "code" }),
      ev({ type: "thought", content: "done", }),
    ];
    const phases = groupPhases(mergeEvents(events));
    const categories = phases.map((phase) => phase.category);
    expect(categories).toEqual(["thinking", "net", "read", "answer"]);
    // Net phase counted one web_search call; read phase one read call.
    expect(phases[1]?.tools).toEqual([{ tool: "web_search", count: 1 }]);
    expect(phases[2]?.tools).toEqual([{ tool: "read", count: 1 }]);
  });

  it("computes phase duration from event timestamps", () => {
    const events: ArenaEvent[] = [
      ev({ type: "thought_delta", content: "a", timestamp: 1_000 }),
      ev({ type: "thought_delta", content: "b", timestamp: 4_000 }),
      ev({ type: "thought_end", content: "ab", timestamp: 5_000 }),
    ];
    const phases = groupPhases(mergeEvents(events));
    expect(phases).toHaveLength(1);
    // A tool-free turn's last thought is marked final → one answer phase.
    expect(phases[0]?.category).toBe("answer");
    // Duration runs first delta (1s) to last delta (4s) = 3s of streaming.
    expect(phases[0]?.durationMs).toBe(3_000);
  });

  it("splits same-category work into separate phases when the actor changes", () => {
    const events: ArenaEvent[] = [
      ev({ type: "reflect", content: "[AutoGen group chat] speaker: coder" }),
      ev({ type: "action", tool: "read", args: { path: "a.js" } }),
      ev({ type: "observation", tool: "read", result: "code" }),
      ev({ type: "reflect", content: "[AutoGen reviewer] looks good" }),
      ev({ type: "action", tool: "read", args: { path: "b.js" } }),
      ev({ type: "observation", tool: "read", result: "more code" }),
    ];
    const phases = groupPhases(mergeEvents(events));
    // The two read runs must not fold into one row: different actors did them.
    // Each actor's speaker/critique reflect paints its own "other" row first.
    expect(phases.map((phase) => phase.actor)).toEqual([
      "AutoGen coder",
      "AutoGen coder",
      "AutoGen reviewer",
      "AutoGen reviewer",
    ]);
    expect(phases.map((phase) => phase.category)).toEqual(["other", "read", "other", "read"]);
  });

  it("carries CrewAI task dispatch onto the worker's segments via sticky actor", () => {
    const events: ArenaEvent[] = [
      ev({ type: "reflect", content: "[CrewAI crew] task 1/3 → Researcher: Investigate the workspace." }),
      ev({ type: "thought_delta", content: "reading files" }),
      ev({ type: "thought_end" }),
      ev({ type: "action", tool: "ls", args: {} }),
      ev({ type: "observation", tool: "ls", result: "README.md" }),
    ];
    const segments = mergeEvents(events);
    // reflect + streamed thought + action(with folded observation) — all the researcher's.
    expect(segments.map((seg) => seg.actor)).toEqual([
      "CrewAI Researcher",
      "CrewAI Researcher",
      "CrewAI Researcher",
    ]);
  });

  it("keeps single-agent flows actor-free (undefined folds as before)", () => {
    const events: ArenaEvent[] = [
      ev({ type: "action", tool: "read", args: { path: "a.js" } }),
      ev({ type: "observation", tool: "read", result: "code" }),
      ev({ type: "action", tool: "read", args: { path: "b.js" } }),
      ev({ type: "observation", tool: "read", result: "more" }),
    ];
    const phases = groupPhases(mergeEvents(events));
    expect(phases).toHaveLength(1);
    expect(phases[0]?.actor).toBeUndefined();
  });

  it("skips banner meta segments and keeps the final answer as its own phase", () => {
    const events: ArenaEvent[] = [
      ev({ type: "thought", content: "[Native Agent] banner" }),
      ev({ type: "thought", content: "interim" }),
      ev({ type: "thought", content: "final" }),
    ];
    const phases = groupPhases(mergeEvents(events));
    // meta banner skipped; interim thought folds; final answer separate.
    expect(phases.map((phase) => phase.category)).toEqual(["thinking", "answer"]);
    expect(phases[1]?.final).toBe(true);
  });

  it("drops settled step markers; only the pending live tail keeps a steps row", () => {
    const events: ArenaEvent[] = [
      ev({ type: "step_start", step: 1 }),
      ev({ type: "thought", content: "thinking", step: 1 }), // settles step 1
      ev({ type: "step_start", step: 2 }), // still pending at the live tail
    ];
    const phases = groupPhases(mergeEvents(events));
    // Settled step 1 paints no row (SegmentRow hides it too); the pending
    // marker at the tail stays so the live view shows "calling model".
    // The lone thought is the turn's last → marked final (answer), per the
    // tool-free folding convention.
    expect(phases.map((phase) => phase.category)).toEqual(["answer", "other"]);
  });
});

describe("classifyTool", () => {
  it("maps tool names to display categories with the legacy run alias", () => {
    expect(classifyTool("bash")).toBe("code");
    // Pre-rename journals still carry "run": the display alias keeps their category.
    expect(classifyTool("run")).toBe("code");
    expect(classifyTool("run_job")).toBe("code");
    expect(classifyTool("read")).toBe("read");
    expect(classifyTool("ask_user")).toBe("ask");
    expect(classifyTool("totally_new_tool")).toBe("other");
  });
});
