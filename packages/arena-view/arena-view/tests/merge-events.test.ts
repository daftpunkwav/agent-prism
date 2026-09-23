/**
 * @file merge-events tests
 * @description Locks segment merging: observation folding, step markers, thought accumulation, banner filtering.
 */

import { describe, expect, it } from "vitest";
import { PIPELINE_BANNER_PREFIX } from "@agentprism/contracts";
import type { ArenaEvent } from "@agentprism/contracts";
import { actorTagOf, mergeEvents } from "@agentprism/arena-view";

/** Builds a minimal event carrying step/turn. */
function ev(type: ArenaEvent["type"], step: number, extra: Partial<ArenaEvent> = {}): ArenaEvent {
  return { type, pipeline: "c1", step, turn: 0, timestamp: 0, ...extra } as ArenaEvent;
}

describe("mergeEvents event merging", () => {
  it("observation folds into its action segment as the call result", () => {
    const segs = mergeEvents([
      ev("action", 2, { tool: "ls", args: { path: "docs" } }),
      ev("observation", 2, { result: "a.txt" }),
      ev("action", 4, { tool: "read", args: { path: "a.txt" } }),
      ev("observation", 4, { result: "file contents" }),
      ev("observation", 4, { result: "orphan: no action opened before it" }),
    ]);
    const actions = segs.filter((seg) => seg.kind === "action");
    expect(actions).toHaveLength(2);
    expect(actions[0]!.tool).toBe("ls");
    expect(actions[0]!.result).toBe("a.txt");
    expect(actions[0]!.resultDone).toBe(true);
    expect(actions[1]!.result).toBe("file contents");
    // Orphan observation (no preceding action) stays a standalone segment
    const orphans = segs.filter((seg) => seg.kind === "observation");
    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.text).toBe("orphan: no action opened before it");
  });

  it("a new LLM-side event closes the open action so later observations stay standalone", () => {
    const segs = mergeEvents([
      ev("action", 2, { tool: "bash" }),
      ev("step_start", 3),
      ev("observation", 3, { result: "stale output" }),
    ]);
    expect(segs.filter((seg) => seg.kind === "action")).toHaveLength(1);
    const orphans = segs.filter((seg) => seg.kind === "observation");
    expect(orphans).toHaveLength(1);
  });

  it("tool_progress streams into the action result; the following observation finalizes it", () => {
    const segs = mergeEvents([
      ev("action", 2, { tool: "bash", args: { command: "pytest" } }),
      ev("tool_progress", 2, { content: "1 passed" }),
      ev("tool_progress", 2, { content: " in 1s" }),
      ev("observation", 2, { result: "" }),
    ]);
    expect(segs.filter((seg) => seg.kind === "tool_progress")).toHaveLength(0);
    const action = segs.find((seg) => seg.kind === "action")!;
    expect(action.result).toBe("1 passed in 1s");
    expect(action.resultDone).toBe(true);
  });

  it("file_diff folds into the open action as the diff payload", () => {
    const segs = mergeEvents([
      ev("action", 2, { tool: "write", args: { path: "a.py" } }),
      ev("file_diff", 2, { content: "+ print(1)" }),
    ]);
    expect(segs.filter((seg) => seg.kind === "file_diff")).toHaveLength(0);
    const action = segs.find((seg) => seg.kind === "action")!;
    expect(action.diff).toBe("+ print(1)");
  });

  it("step_start opens a pending step segment; content of the same step settles it", () => {
    const segs = mergeEvents([
      ev("step_start", 1),
      ev("thinking", 1, { content: "ponder" }),
      ev("step_start", 2),
    ]);
    const steps = segs.filter((seg) => seg.kind === "step");
    expect(steps).toHaveLength(2);
    expect(steps[0]!.completed).toBe(true); // thinking content arrived for step 1
    expect(steps[1]!.completed).toBe(false); // step 2 still waiting for the first token
    expect(steps[1]!.step).toBe(2);
  });

  it("duplicate step_start for the same step does not create a second pending marker", () => {
    const segs = mergeEvents([ev("step_start", 1), ev("step_start", 1)]);
    expect(segs.filter((seg) => seg.kind === "step")).toHaveLength(1);
  });

  it("thought_delta accumulates by step; thought_end seals it", () => {
    const segs = mergeEvents([
      ev("thought_delta", 1, { content: "Hel" }),
      ev("thought_delta", 1, { content: "lo" }),
      ev("thought_end", 1),
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.kind).toBe("thought");
    expect(segs[0]!.text).toBe("Hello");
    expect(segs[0]!.completed).toBe(true);
  });

  it("foreign pipeline banners are filtered; own-column banners kept and flagged as meta", () => {
    const foreign = `${PIPELINE_BANNER_PREFIX.langchain} reasoning=react`;
    const own = `${PIPELINE_BANNER_PREFIX.native} reasoning=react`;
    const segs = mergeEvents(
      [ev("thought", 0, { content: foreign }), ev("thought", 0, { content: own })],
      "native",
    );
    expect(segs).toHaveLength(1);
    expect(segs[0]!.text).toBe(own);
    expect(segs[0]!.meta).toBe(true);
  });

  it("harness_edit produces a self-evolve segment (previously dropped in single-column view)", () => {
    const segs = mergeEvents([ev("harness_edit", 2, { content: "[self-evolve #1] append prompt" })]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.kind).toBe("harness_edit");
    expect(segs[0]!.text).toContain("self-evolve");
  });

  it("ignores complete/token_update metadata", () => {
    const segs = mergeEvents([ev("complete", 0), ev("token_update", 0)]);
    expect(segs).toHaveLength(0);
  });

  it("thinking segments accumulate separately and do not mix into the visible answer", () => {
    const segs = mergeEvents([
      ev("thinking", 1, { content: "inner" }),
      ev("thinking", 1, { content: "voice" }),
      ev("thought_delta", 1, { content: "answer" }),
    ]);
    expect(segs.filter((seg) => seg.kind === "step")).toHaveLength(0); // no step_start emitted
    expect(segs[0]!.kind).toBe("thinking");
    expect(segs[0]!.text).toBe("innervoice");
    expect(segs[1]!.kind).toBe("thought");
    expect(segs[1]!.text).toBe("answer");
  });

  it("marks the last settled thought per turn as the final reply, earlier ones as interim steps", () => {
    const segs = mergeEvents([
      ev("thought_delta", 1, { content: "plan A" }),
      ev("thought_end", 1),
      ev("thought_delta", 2, { content: "reflection on plan A" }),
      ev("thought_end", 2),
      ev("thought_delta", 3, { content: "final hello" }),
      ev("thought_end", 3),
    ]);
    const thoughts = segs.filter((seg) => seg.kind === "thought");
    expect(thoughts.map((seg) => seg.final)).toEqual([undefined, undefined, true]);
  });

  it("marks the last settled thought per turn across multiple turns independently", () => {
    const segs = mergeEvents([
      ev("thought_delta", 1, { content: "turn one answer", turn: 1 }),
      ev("thought_end", 1, { turn: 1 }),
      ev("thought_delta", 1, { content: "turn two interim", turn: 2 }),
      ev("thought_end", 1, { turn: 2 }),
      ev("thought_delta", 2, { content: "turn two final", turn: 2 }),
      ev("thought_end", 2, { turn: 2 }),
    ]);
    const thoughts = segs.filter((seg) => seg.kind === "thought");
    expect(thoughts.map((seg) => [seg.turn, seg.final])).toEqual([
      [1, true],
      [2, undefined],
      [2, true],
    ]);
  });

  it("leaves a still-streaming last thought unmarked and banners never count as answers", () => {
    const banner = `${PIPELINE_BANNER_PREFIX.native} Tool Calling · model=x`;
    const segs = mergeEvents([
      ev("thought", 0, { content: banner }),
      ev("thought_delta", 1, { content: "settled interim" }),
      ev("thought_end", 1),
      ev("thought_delta", 2, { content: "still streaming" }),
    ]);
    const thoughts = segs.filter((seg) => seg.kind === "thought");
    expect(thoughts).toHaveLength(3); // banner + settled + streaming
    expect(thoughts.filter((seg) => seg.final)).toHaveLength(1);
    expect(thoughts.find((seg) => seg.final)!.text).toBe("settled interim");
  });
});

describe("actorTagOf", () => {
  it("resolves autogen speaker lines, crewai task dispatches, and bracket tags", () => {
    expect(actorTagOf("reflect", "[AutoGen group chat] speaker: coder")).toBe("AutoGen coder");
    expect(actorTagOf("reflect", "[CrewAI crew] task 1/3 → Researcher: Investigate.")).toBe("CrewAI Researcher");
    expect(actorTagOf("thought_delta", "[AutoGen reviewer] critique body")).toBe("AutoGen reviewer");
    expect(actorTagOf("action", "[AutoGen coder]")).toBeNull();
    expect(actorTagOf("thought", "no label here")).toBeNull();
  });

  it("classifies thought step roles from event order, not text", () => {
    const segs = mergeEvents([
      ev("thought", 1, { content: "plan the work" }),
      ev("action", 1, { tool: "write", args: { path: "a.txt" } }),
      ev("observation", 1, { result: "wrote a.txt" }),
      ev("thought", 2, { content: "result looks good; next I will read it back" }),
      ev("action", 2, { tool: "read", args: { path: "a.txt" } }),
      ev("observation", 2, { result: "contents" }),
      ev("thought", 3, { content: "all verified; done" }),
    ]);
    const thoughts = segs.filter((seg) => seg.kind === "thought" && !seg.meta);
    expect(thoughts).toHaveLength(3);
    // Thought leading into the FIRST call: action.
    expect(thoughts[0]!.stepRole).toBe("action");
    // Sandwiched between a folded result and the next call: both roles at once — unlabeled.
    expect(thoughts[1]!.stepRole).toBeUndefined();
    // Wrap-up after the last result with no further call: observation.
    expect(thoughts[2]!.stepRole).toBe("observation");
  });

  it("stays unlabeled for tool-free chat and skips thinking when classifying", () => {
    const plain = mergeEvents([
      ev("thought", 1, { content: "just chatting" }),
      ev("thought_end", 1),
    ]);
    expect(plain.find((seg) => seg.kind === "thought")?.stepRole).toBeUndefined();

    const segs = mergeEvents([
      ev("thought", 1, { content: "hidden reasoning then act" }),
      ev("thinking", 1, { content: "internal monologue" }),
      ev("action", 1, { tool: "bash" }),
      ev("observation", 1, { result: "ok" }),
      ev("thought", 2, { content: "wrap up" }),
    ]);
    const thoughts = segs.filter((seg) => seg.kind === "thought");
    // The thinking segment between thought and action does not break the action classification.
    expect(thoughts[0]!.stepRole).toBe("action");
    expect(thoughts[1]!.stepRole).toBe("observation");
  });
});
