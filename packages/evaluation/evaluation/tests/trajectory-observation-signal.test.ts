/**
 * @file trajectory observation-signal tests
 * @description Locks how failed tool observations are detected.
 *
 * Responsibilities:
 * - Pin that the structured `ok` flag decides when the producer provided it
 * - Pin that a successful output mentioning "error" mid-line is not a failure
 * - Pin that a line-anchored keyword still catches failures without a flag
 */

import { describe, expect, it } from "vitest";
import type { ArenaEvent } from "@agentprism/contracts";
import { evaluateTrajectory } from "../src/trajectory.js";

function action(tool: string, args: Record<string, unknown> = {}): ArenaEvent {
  return { type: "action", tool, args, workspace: "ws" } as ArenaEvent;
}

function observation(result: string, ok?: boolean): ArenaEvent {
  return { type: "observation", result, ...(ok === undefined ? {} : { ok }), workspace: "ws" } as ArenaEvent;
}

function complete(success: boolean): ArenaEvent {
  return {
    type: "complete",
    workspace: "ws",
    metrics: {
      success,
      steps: 3,
      tool_calls: 3,
      duration_ms: 100,
      input_tokens: 50,
      output_tokens: 50,
      total_tokens: 100,
      context_window: 128000,
      max_input_tokens: 120000,
      max_output_tokens: 96000,
      context_usage_pct: 0.01,
      input_usage_pct: 0.01,
    },
  } as ArenaEvent;
}

const dim = (score: ReturnType<typeof evaluateTrajectory>, name: string) =>
  (score.dimensions as Record<string, { score: number; evidence: string[] }>)[name]!;

/** Three successful writes whose contents happen to mention error handling. */
function successfulWorkMentioningErrors(): ArenaEvent[] {
  return [
    action("write", { path: "a.py" }),
    observation("# error handling\nexcept ValueError as exc:\n    raise", true),
    action("write", { path: "b.py" }),
    observation("invalid tokens are rejected by the parser", true),
    action("write", { path: "c.py" }),
    observation("traceback helper installed", true),
    complete(true),
  ];
}

describe("observation failure detection", () => {
  it("keeps a successful run clean when its output merely mentions the words", () => {
    const score = evaluateTrajectory(successfulWorkMentioningErrors());
    expect(dim(score, "error_recovery").score).toBe(1);
    expect(dim(score, "tool_efficiency").score).toBe(1);
  });

  it("treats a structured failure flag as a failure even with harmless-looking text", () => {
    const events = [
      action("read", { path: "a.txt" }),
      observation("done", false),
      action("read", { path: "a.txt" }),
      observation("done", false),
      complete(false),
    ];
    const score = evaluateTrajectory(events);
    expect(dim(score, "error_recovery").score).toBeLessThan(1);
  });

  it("catches a keyword failure that starts a later line of a multi-line output", () => {
    const events = [
      action("bash", { command: "make build" }),
      // The keyword must be matched at a line start, not only at the start of the string.
      observation(["compiling module A", "compiling module B", "Error: undefined reference to main"].join("\n")),
      complete(false),
    ];
    const score = evaluateTrajectory(events);
    expect(dim(score, "error_recovery").score).toBeLessThan(1);
  });

  it("still catches keyword failures when the producer sent no flag", () => {
    const events = [
      action("bash", { command: "python x.py" }),
      observation("Error: python not found"),
      action("bash", { command: "python x.py" }),
      observation("Error: python not found"),
      complete(false),
    ];
    const score = evaluateTrajectory(events);
    expect(dim(score, "error_recovery").score).toBeLessThan(1);
  });
});
