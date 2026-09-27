/**
 * @file builder turn failure rule tests
 * @description Locks how a finished turn's event stream is judged.
 *
 * Responsibilities:
 * - Pin that a retried-then-succeeded turn commits (intermediate error is evidence)
 * - Pin that a failed or missing terminal complete still fails the turn
 * - Pin that an error AFTER the terminal complete fails the turn
 */

import { describe, expect, it } from "vitest";
import type { ArenaEvent } from "@agentprism/contracts";
import { turnFailed } from "../src/turn-runner.js";

function event(type: ArenaEvent["type"], overrides: Record<string, unknown> = {}): ArenaEvent {
  return { type, pipeline: "builder", workspace: "ws", turn: 1, ...overrides } as ArenaEvent;
}

const failureComplete = () =>
  event("complete", { metrics: { success: false, steps: 1, tool_calls: 0 } as never });
const successComplete = () =>
  event("complete", { metrics: { success: true, steps: 1, tool_calls: 0 } as never });

describe("turnFailed", () => {
  it("does not fail a turn whose retry succeeded", () => {
    // The harness forwards the first attempt's error and then the retry's complete.
    expect(turnFailed([event("thought", { content: "attempt" }), event("error", { message: "provider 401" }), successComplete()])).toBe(false);
  });

  it("fails a turn that never produced a terminal complete", () => {
    expect(turnFailed([event("thought", { content: "started" })])).toBe(true);
  });

  it("fails a turn whose terminal complete reports failure", () => {
    expect(turnFailed([event("error", { message: "boom" }), failureComplete()])).toBe(true);
  });

  it("fails a turn that errored after its terminal complete", () => {
    expect(turnFailed([successComplete(), event("error", { message: "late failure" })])).toBe(true);
  });
});
