/**
 * @file trace-log.test
 * @description Unit tests for the trace-entry factory.
 *
 * Responsibilities:
 * - Pin monotonic sequencing, timestamps, and the uncut persistence hook
 */

import { describe, expect, it } from "vitest";
import type { BuilderTraceEntry, Clock, IdGenerator } from "@agentprism/contracts";
import { TraceLog } from "../src/trace-log.js";

const clock: Clock = { now: () => 1_000 };
const idGenerator: IdGenerator = { next: (() => {
  let n = 0;
  return () => `id-${(n += 1)}`;
})() };

describe("TraceLog", () => {
  it("assigns monotonic sequence numbers and timestamps", () => {
    const log = new TraceLog({ idGenerator, clock });
    const first = log.append("session", "a", {});
    const second = log.append("llm_request", "b", {});
    expect(second.seq).toBe(first.seq + 1);
    expect(second.ts).toBe(1_000);
    expect(second.id).not.toBe(first.id);
  });

  it("forwards every entry uncut to the persistence hook", () => {
    const appended: BuilderTraceEntry[] = [];
    const log = new TraceLog({ idGenerator, clock, onAppend: (entry) => appended.push(entry) });
    const huge = "x".repeat(80_000);
    const entry = log.append("llm_request", "big", { messages: huge });
    expect(appended).toEqual([entry]);
    // Full-fidelity capture: the journal receives the payload unclipped.
    expect((appended[0]?.data.messages as string).length).toBe(80_000);
  });

  it("carries turn and duration fields", () => {
    const log = new TraceLog({ idGenerator, clock });
    const entry = log.append("llm_response", "r", {}, { turn: 2, durationMs: 42 });
    expect(entry.turn).toBe(2);
    expect(entry.durationMs).toBe(42);
  });
});
