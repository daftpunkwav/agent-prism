/**
 * @file self-consistency tests
 * @description Covers the LangGraph self-consistency attempt loop and vote outcome.
 *
 * Responsibilities:
 * - Pin that every attempt streams normally and only non-empty answers are voted on
 * - Lock the reflect outcome for majority, tie, and empty sample sets
 */

import { describe, expect, it } from "vitest";
import type { ArenaEvent } from "@agentprism/contracts";
import { runSelfConsistencyLoop } from "../src/self-consistency.js";

function thoughtEvent(content: string): ArenaEvent {
  return {
    type: "thought",
    pipeline: "col",
    workspace: "ws",
    content,
    tool: "",
    args: {},
    result: "",
    step: 0,
    passed: null,
    reason: "",
    metrics: null,
    message: "",
    token_stats: null,
    turn: 1,
    runId: "r1",
    timestamp: 0,
  } as ArenaEvent;
}

/** Attempt factory: attempt N emits the scripted thought (empty entries emit nothing). */
function attemptFactory(answers: string[]): (attempt: number) => AsyncGenerator<ArenaEvent> {
  return async function* (attempt: number) {
    const answer = answers[attempt - 1];
    if (answer !== undefined && answer !== "") yield thoughtEvent(answer);
  };
}

async function collect(generator: AsyncGenerator<ArenaEvent>): Promise<ArenaEvent[]> {
  const events: ArenaEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

const fields = { label: "col", workspace: "ws", step: () => 7 };

describe("runSelfConsistencyLoop", () => {
  it("streams every attempt and settles with a majority-vote reflect event", async () => {
    const events = await collect(
      runSelfConsistencyLoop({
        attempts: 3,
        attemptStream: attemptFactory(["42", "42", "43"]),
        fields,
      }),
    );
    // Every attempt streamed its answer verbatim before the vote settled.
    const reflectIndex = events.findIndex((event) => event.type === "reflect");
    const attemptThoughts = events
      .slice(0, reflectIndex)
      .filter((event) => event.type === "thought");
    expect(attemptThoughts).toHaveLength(3);
    const reflect = events[reflectIndex];
    expect(String(reflect?.content)).toContain("3/3 attempt(s) completed");
    expect(String(reflect?.content)).toContain("attempt 1 wins");
    expect(String(reflect?.content)).toContain("attempt 1: 2 vote(s)"); // winning sample's tally
    expect(String(reflect?.content)).toContain("attempt 3: 1 vote(s)"); // minority sample still tallied
    expect(reflect?.step).toBe(7);
  });

  it("ignores attempts that produced no extractable answer", async () => {
    const events = await collect(
      runSelfConsistencyLoop({
        attempts: 2,
        attemptStream: attemptFactory(["", "9"]),
        fields,
      }),
    );
    const reflect = events.find((event) => event.type === "reflect");
    expect(String(reflect?.content)).toContain("1/2 attempt(s) completed");
  });

  it("reports a no-answer reflect event when every attempt came up empty", async () => {
    const events = await collect(
      runSelfConsistencyLoop({ attempts: 2, attemptStream: attemptFactory(["", ""]), fields }),
    );
    expect(events).toHaveLength(1); // no attempt events, only the outcome
    const reflect = events[0]!;
    expect(reflect.type).toBe("reflect");
    expect(String(reflect.content)).toContain("no attempt produced an answer");
    expect(String(reflect.content)).toContain("2 attempt slot(s)");
  });
});
