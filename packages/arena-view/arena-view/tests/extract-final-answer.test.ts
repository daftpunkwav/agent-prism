/**
 * @file extract-final-answer tests
 * @description Covers final-answer extraction from the event stream.
 *
 * Responsibilities:
 * - Pin the thought-sequence-first, observation-fallback selection order
 */

import { describe, expect, it } from "vitest";
import type { ArenaEvent } from "@agentprism/contracts";
import { extractFinalAnswer } from "../src/extract-final-answer.js";

/** Builds a minimal event with the full shape (shape single source: contracts/ArenaEvent). */
function ev(fields: Partial<ArenaEvent> & { type: ArenaEvent["type"] }): ArenaEvent {
  return {
    pipeline: "c1",
    turn: 1,
    step: 0,
    timestamp: 0,
    workspace: "",
    tool: "",
    args: {},
    result: "",
    content: "",
    passed: null,
    reason: "",
    message: "",
    metrics: null,
    token_stats: null,
    ...fields,
  } as ArenaEvent;
}

describe("extractFinalAnswer final answer extraction", () => {
  it("defaults to the last turn: thought takes priority over observation", () => {
    const events = [
      ev({ type: "observation", turn: 1, result: "turn 1 observation" }),
      ev({ type: "thought", turn: 2, content: "turn 2 answer" }),
      ev({ type: "observation", turn: 2, result: "turn 2 observation" }),
    ];
    expect(extractFinalAnswer(events)).toBe("turn 2 answer");
  });

  it("when a turn is specified, only that turn's events are counted", () => {
    const events = [
      ev({ type: "thought", turn: 1, content: "turn 1 answer" }),
      ev({ type: "thought", turn: 2, content: "turn 2 answer" }),
    ];
    expect(extractFinalAnswer(events, 1)).toBe("turn 1 answer");
  });

  it("thought_delta accumulates by delta; thought_end with content overrides the accumulated value", () => {
    const deltaEvents = [
      ev({ type: "thought_delta", content: "final" }),
      ev({ type: "thought_delta", content: "AnswerIs" }),
      ev({ type: "thought_delta", content: "42" }),
    ];
    expect(extractFinalAnswer(deltaEvents)).toBe("finalAnswerIs42");

    const endOverride = [
      ...deltaEvents,
      ev({ type: "thought_end", content: "deduped full answer" }),
    ];
    expect(extractFinalAnswer(endOverride)).toBe("deduped full answer");
  });

  it("falls back to the last observation when there is no thought", () => {
    const events = [
      ev({ type: "observation", turn: 1, result: "observation one" }),
      ev({ type: "observation", turn: 1, result: "observation two" }),
    ];
    expect(extractFinalAnswer(events)).toBe("observation two");
  });

  it("keeps the tail when exceeding 4000 characters", () => {
    const long = "x".repeat(5000) + "tail answer";
    const extracted = extractFinalAnswer([ev({ type: "thought", content: long })]);
    expect(extracted).toHaveLength(4000);
    expect(extracted.endsWith("tail answer")).toBe(true);
  });
});
