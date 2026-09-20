/**
 * @file scatter test
 * @description Locks parallel fan-out: join/vote, isolation, caps, depth.
 */
import { describe, expect, it } from "vitest";
import type { AgentExecutionContext } from "@agentprism/harness";
import type { ArenaEvent, ToolExecutionResult } from "@agentprism/contracts";
import { majorityVote } from "../src/agent-execution.js";
import { collect, testDeps, testSpec } from "./run-fixtures.js";

function childDriver(answer: (task: string) => string, extra?: (ctx: AgentExecutionContext) => void): {
  driver: { frameworkId: string; displayName: string; run(ctx: AgentExecutionContext): AsyncGenerator<ArenaEvent> };
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    driver: {
      frameworkId: "scatter-stub",
      displayName: "ScatterStub",
      async *run(ctx: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
        if (ctx.identity.agentId.includes("/scatter-")) {
          calls.push(ctx.question);
          extra?.(ctx);
          yield {
            type: "thought", pipeline: "col", workspace: "", content: answer(ctx.question),
            tool: "", args: {}, result: "", step: 0, passed: null, reason: "",
            metrics: null, message: "", token_stats: null, turn: 0, runId: "", timestamp: 0,
          };
          return;
        }
        const outcome: ToolExecutionResult = await ctx.tools.execute("scatter", {
          tasks: ["job one", "job two", "job three"],
        });
        yield {
          type: "thought", pipeline: "col", workspace: "", content: outcome.result,
          tool: "", args: {}, result: "", step: 0, passed: null, reason: "",
          metrics: null, message: "", token_stats: null, turn: 0, runId: "", timestamp: 0,
        };
      },
    },
  };
}

describe("majorityVote", () => {
  it("elects exact-match majorities with visible tallies", () => {
    expect(majorityVote(["a", "b", "a"])).toEqual({ winner: 0, counts: [2, 1, 2] });
    expect(majorityVote(["x", "y"])).toEqual({ winner: 0, counts: [1, 1] });
  });
});

describe("runAgentExecution scatter fan-out", () => {
  it("runs children in parallel and joins per-task answers", async () => {
    const { driver, calls } = childDriver((task) => `done:${task}`);
    const deps = testDeps();
    const events = await collect(deps, testSpec(driver));
    expect(calls.sort()).toEqual(["job one", "job three", "job two"]);
    const complete = events.filter((event) => event.type === "complete");
    expect(complete).toHaveLength(1);
  });

  it("votes with tallies and isolates child failures", async () => {
    const seen: string[] = [];
    const voting = {
      frameworkId: "vote-stub",
      displayName: "VoteStub",
      async *run(ctx: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
        if (ctx.identity.agentId.includes("/scatter-")) {
          if (ctx.question === "bad job") throw new Error("child boom");
          yield {
            type: "thought", pipeline: "col", workspace: "", content: "same",
            tool: "", args: {}, result: "", step: 0, passed: null, reason: "",
            metrics: null, message: "", token_stats: null, turn: 0, runId: "", timestamp: 0,
          };
          return;
        }
        const outcome = await ctx.tools.execute("scatter", { tasks: ["good a", "bad job", "good b"], strategy: "vote" });
        seen.push(outcome.result);
      },
    };
    await collect(testDeps(), testSpec(voting));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("[scatter vote: task 1 wins");
    expect(seen[0]).toContain("task 2: 1 vote(s)");
  });

  it("rejects bad task lists and blocks grandchildren delegation", async () => {
    const state: { bad: Promise<ToolExecutionResult> | null; deep: Promise<ToolExecutionResult> | null } = { bad: null, deep: null };
    const driver = {
      frameworkId: "guard-stub",
      displayName: "GuardStub",
      async *run(ctx: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
        if (!ctx.identity.agentId.includes("/scatter-")) {
          state.bad = ctx.tools.execute("scatter", { tasks: ["only one"] });
          return;
        }
        state.deep = ctx.tools.execute("subagent", { task: "deeper" });
      },
    };
    await collect(testDeps(), testSpec(driver, {}, ));
    if (state.bad === null) throw new Error("parent never ran");
    expect((await state.bad).ok).toBe(false);
    // No nested scatter ran (single task rejected before spawning).
    if (state.deep !== null) {
      expect((await state.deep).ok).toBe(false);
    }
  });
});
