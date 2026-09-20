/**
 * @file trajectory tests
 * @description Unit tests for execution trajectory evaluation across all four quality dimensions.
 */

import { describe, expect, it } from "vitest";
import type { ArenaEvent, TrajectoryDimensionScore, TrajectoryScore } from "@agentprism/contracts";
import {
  deterministicTrajectoryJudge,
  evaluateTrajectories,
  evaluateTrajectory,
  evaluateTrajectoryAsync,
} from "../src/trajectory.js";

function thought(content: string): ArenaEvent {
  return { type: "thought", content, workspace: "ws" } as ArenaEvent;
}

function action(tool: string, args: Record<string, unknown> = {}): ArenaEvent {
  return { type: "action", tool, args, workspace: "ws" } as ArenaEvent;
}

function observation(result: string): ArenaEvent {
  return { type: "observation", result, workspace: "ws" } as ArenaEvent;
}

function reflect(content: string): ArenaEvent {
  return { type: "reflect", content, workspace: "ws" } as ArenaEvent;
}

function complete(success: boolean, steps: number = 3, toolCalls: number = 2): ArenaEvent {  return {
    type: "complete",
    workspace: "ws",
    metrics: {
      success,
      steps,
      tool_calls: toolCalls,
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

/** Fetches one scored dimension (throws when the evaluator drops a dimension). */
function dim(score: TrajectoryScore, name: string): TrajectoryDimensionScore {
  const dimension = score.dimensions[name];
  if (dimension === undefined) throw new Error(`missing trajectory dimension: ${name}`);
  return dimension;
}

describe("evaluateTrajectory", () => {
  it("awards high scores to a smooth, coherent execution trajectory", () => {
    const events: ArenaEvent[] = [
      thought("First I will examine the directory structure to locate the target file."),
      action("ls", { path: "." }),
      observation("src\npackage.json\nREADME.md"),
      thought("Now I will inspect package.json to read dependencies."),
      action("read", { file: "package.json" }),
      observation('{"name": "test-pkg", "version": "1.0.0"}'),
      thought("The inspection is complete, I have the required answer."),
      complete(true, 3, 2),
    ];

    const score = evaluateTrajectory(events, { question: "What is the package name?" });

    expect(score.overall).toBeGreaterThanOrEqual(0.85);
    expect(score.passed).toBe(true);
    expect(dim(score, "tool_efficiency").score).toBe(1.0);
    expect(dim(score, "planning_coherence").score).toBe(1.0);
    expect(dim(score, "error_recovery").score).toBe(1.0);
    expect(dim(score, "step_economy").score).toBe(1.0);
    expect(score.summary).toContain("PASS");
  });

  it("penalizes tool repetition loops and deadlocks in tool_efficiency", () => {
    const events: ArenaEvent[] = [
      thought("I will read the file."),
      action("read", { file: "missing.txt" }),
      observation("Error: ENOENT: no such file or directory"),
      action("read", { file: "missing.txt" }),
      observation("Error: ENOENT: no such file or directory"),
      action("read", { file: "missing.txt" }),
      observation("Error: ENOENT: no such file or directory"),
      complete(false, 3, 3),
    ];

    const score = evaluateTrajectory(events);

    expect(dim(score, "tool_efficiency").score).toBeLessThanOrEqual(0.6);
    expect(dim(score, "tool_efficiency").evidence.some((e) => e.includes("missing.txt"))).toBe(true);
    expect(dim(score, "error_recovery").score).toBeLessThanOrEqual(0.5);
    expect(score.passed).toBe(false);
  });

  it("recognizes self-healing and error recovery when agent recovers from failures", () => {
    const events: ArenaEvent[] = [
      thought("Attempting primary method."),
      action("run", { command: "python script.py" }),
      observation("Error: python not found"),
      reflect("Python is not installed. Let me switch to node script.js instead."),
      thought("Running with Node.js fallback."),
      action("run", { command: "node script.js" }),
      observation("Success: computed 42"),
      thought("Calculation succeeded with the fallback."),
      complete(true, 4, 2),
    ];

    const score = evaluateTrajectory(events);

    expect(dim(score, "error_recovery").score).toBeGreaterThanOrEqual(0.9);
    expect(dim(score, "error_recovery").reason).toContain("self-healed");
    expect(dim(score, "planning_coherence").evidence.some((e) => e.includes("reflection"))).toBe(true);
    expect(score.passed).toBe(true);
  });

  it("penalizes trajectories without thought events and excessive steps", () => {
    const events: ArenaEvent[] = [
      action("read", { file: "a.txt" }),
      observation("data a"),
      action("read", { file: "b.txt" }),
      observation("data b"),
      complete(false, 45, 2),
    ];

    const score = evaluateTrajectory(events);

    expect(dim(score, "planning_coherence").score).toBeLessThanOrEqual(0.6);
    expect(dim(score, "step_economy").score).toBeLessThanOrEqual(0.5);
    expect(score.passed).toBe(false);
  });

  it("evaluates batch trajectories correctly", () => {
    const traces = {
      col_good: [
        thought("Plan cleanly"),
        action("ls", {}),
        observation("files"),
        complete(true, 1, 1),
      ],
      col_bad: [
        action("read", { file: "bad" }),
        observation("Error: failed"),
        complete(false, 1, 1),
      ],
    };

    const scores = evaluateTrajectories(traces);

    expect(scores["col_good"]?.passed).toBe(true);
    expect(scores["col_bad"]?.passed).toBe(false);
  });
});

describe("evaluateTrajectoryAsync", () => {
  it("incorporates LLM judge response when adapter succeeds", async () => {
    const events: ArenaEvent[] = [
      thought("Thinking step"),
      action("ls", {}),
      observation("result"),
      complete(true, 2, 1),
    ];

    const mockAdapter = {
      invoke: async () =>
        JSON.stringify({
          overall: 0.92,
          passed: true,
          summary: "Outstanding step-by-step reasoning.",
          reason: "Direct and minimal.",
        }),
    };

    const score = await evaluateTrajectoryAsync(events, { adapter: mockAdapter });

    expect(score.overall).toBe(0.92);
    expect(score.passed).toBe(true);
    expect(score.summary).toContain("[LLM-Assisted]");
    expect(score.summary).toContain("Outstanding");
  });

  it("falls back gracefully to deterministic score when adapter fails or throws", async () => {
    const events: ArenaEvent[] = [
      thought("Thinking step"),
      action("ls", {}),
      observation("result"),
      complete(true, 2, 1),
    ];

    const failingAdapter = {
      invoke: async () => {
        throw new Error("Network timeout connecting to LLM judge");
      },
    };

    const score = await evaluateTrajectoryAsync(events, { adapter: failingAdapter });

    expect(score.overall).toBeGreaterThanOrEqual(0.8);
    expect(score.summary).not.toContain("[LLM-Assisted]");
  });

  it("conforms to the TrajectoryJudge contract port", () => {
    expect(typeof deterministicTrajectoryJudge.evaluateTrajectory).toBe("function");
    expect(typeof deterministicTrajectoryJudge.evaluateTrajectoryAsync).toBe("function");
  });
});
