/**
 * @file answer projection tests
 * @description Locks the shared answer-extraction state machine.
 *
 * Responsibilities:
 * - Pin createAnswerProjection (thought priority, banner skip, delta accumulation,
 *   thought_end override/fallback, observation fallback)
 * - Pin extractAnswerFromEvents as a fold over the same machine plus its 2k/trim policy
 * - Pin the interleaving contract: a complete thought inside a delta stream wins,
 *   so incremental and batch readers always agree
 */

import { describe, expect, it } from "vitest";
import {
  ArenaEventSchema,
  createAnswerProjection,
  extractAnswerFromEvents,
  type ArenaEvent,
} from "../src/index.js";

/** Parses a partial event literal (schema fills the defaulted fields). */
function event(fields: Record<string, unknown>): ArenaEvent {
  return ArenaEventSchema.parse({
    pipeline: "col",
    passed: null,
    metrics: null,
    token_stats: null,
    ...fields,
  });
}

describe("createAnswerProjection", () => {
  it("prefers the last thought sequence and falls back to the last observation", () => {
    const projection = createAnswerProjection();
    expect(projection.answer()).toBe("");
    projection.push(event({ type: "observation", result: "tool output" }));
    expect(projection.answer()).toBe("tool output");
    projection.push(event({ type: "thought", content: "first thought" }));
    projection.push(event({ type: "thought", content: "second thought" }));
    expect(projection.answer()).toBe("second thought");
  });

  it("skips config banners on complete thoughts and leading deltas", () => {
    const projection = createAnswerProjection();
    projection.push(event({ type: "thought", content: "[Native Agent] config banner" }));
    projection.push(event({ type: "thought_delta", content: "[LangGraph] banner in deltas" }));
    projection.push(event({ type: "thought_delta", content: "real text" }));
    expect(projection.answer()).toBe("real text");
    // A banner delta after streaming started is folded in like any other chunk.
    projection.push(event({ type: "thought_delta", content: " more" }));
    expect(projection.answer()).toBe("real text more");
  });

  it("accumulates deltas and lets thought_end override or fall back", () => {
    const projection = createAnswerProjection();
    projection.push(event({ type: "thought_delta", content: "hel" }));
    projection.push(event({ type: "thought_delta", content: "lo" }));
    projection.push(event({ type: "thought_end", content: "" }));
    expect(projection.answer()).toBe("hello");
    projection.push(event({ type: "thought_delta", content: "stale" }));
    projection.push(event({ type: "thought_end", content: "final" }));
    expect(projection.answer()).toBe("final");
  });

  it("a tool-only round's empty thought_end keeps the previous text sequence", () => {
    // Mirrors the arena-view pinned behavior (its extract-final-answer test):
    // the judge-side extraction must not swap the answer for raw tool output
    // when the final round closes with no spoken text.
    const events = [
      event({ type: "thought_delta", content: "I will create the file now." }),
      event({ type: "thought_end", content: "" }),
      event({ type: "observation", result: "Wrote: hello.txt" }),
      event({ type: "thought_end", content: "" }),
      event({ type: "observation", result: "hi" }),
    ];
    const projection = createAnswerProjection();
    for (const item of events) projection.push(item);
    expect(projection.answer()).toBe("I will create the file now.");
    expect(extractAnswerFromEvents(events)).toBe("I will create the file now.");
    // A run that never speaks still falls back to the last observation.
    expect(extractAnswerFromEvents([event({ type: "observation", result: "hi" })])).toBe("hi");
  });

  it("ignores events outside the thought and observation channels", () => {
    const projection = createAnswerProjection();
    projection.push(event({ type: "step_start", content: "step" }));
    projection.push(event({ type: "complete", content: "done" }));
    projection.push(event({ type: "thinking", content: "hidden reasoning" }));
    expect(projection.answer()).toBe("");
  });

  it("matches the batch extraction on an interleaved delta and thought stream", () => {
    const events = [
      event({ type: "thought_delta", content: "delta answer" }),
      event({ type: "thought", content: "complete answer" }),
      event({ type: "thought_end", content: "" }),
    ];
    const projection = createAnswerProjection();
    for (const item of events) projection.push(item);
    // The complete thought resets the delta accumulator, so thought_end falls
    // back to it — incremental and batch readers agree by construction.
    expect(projection.answer()).toBe(extractAnswerFromEvents(events));
    expect(projection.answer()).toBe("complete answer");
  });
});

describe("extractAnswerFromEvents", () => {
  it("slices to 2000 chars and trims around the projected answer", () => {
    const long = "x".repeat(2500);
    expect(extractAnswerFromEvents([event({ type: "thought", content: long })])).toHaveLength(2000);
    expect(extractAnswerFromEvents([event({ type: "thought", content: "  padded  " })])).toBe("padded");
  });
});
