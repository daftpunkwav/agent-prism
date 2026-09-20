/**
 * @file ralph_loop tests
 * @description Locks bounded fresh-child rounds: handoffs, statuses, budget, no nesting.
 */

import { describe, expect, it } from "vitest";
import type { AgentDriver, ArenaEvent, ToolExecutionResult } from "@agentprism/contracts";
import type { AgentExecutionContext } from "@agentprism/harness";
import { collect, testDeps, testSpec } from "./run-fixtures.js";

function thought(content: string): ArenaEvent {
  return {
    type: "thought",
    pipeline: "col",
    workspace: "",
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
    turn: 0,
    runId: "",
    timestamp: 0,
  };
}

interface RalphState {
  parentCall: Promise<ToolExecutionResult> | null;
  childCalls: Array<Promise<ToolExecutionResult>>;
  childQuestions: string[];
}

describe("runAgentExecution ralph_loop delegation", () => {
  it("completes on the first round and returns the summary", async () => {
    const state: RalphState = { parentCall: null, childCalls: [], childQuestions: [] };
    const deps = testDeps();
    const driver: AgentDriver = {
      frameworkId: "ralph-stub",
      displayName: "RalphStub",
      async *run(ctx: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
        if (!ctx.identity.agentId.includes("/ralph-")) {
          state.parentCall = ctx.tools.execute("ralph_loop", { objective: "build it" });
          return;
        }
        yield thought("STATUS: complete\nSUMMARY: done it");
      },
    };
    await collect(deps, testSpec(driver));
    if (state.parentCall === null) throw new Error("delegation never ran");
    const outcome = await state.parentCall;
    expect(outcome.ok).toBe(true);
    expect(outcome.result).toContain("[ralph complete after 1 round(s)]");
    expect(outcome.result).toContain("done it");
  });

  it("carries the handoff forward across continue rounds", async () => {
    const state: RalphState = { parentCall: null, childCalls: [], childQuestions: [] };
    const deps = testDeps();
    const driver: AgentDriver = {
      frameworkId: "ralph-stub",
      displayName: "RalphStub",
      async *run(ctx: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
        const agentId = ctx.identity.agentId;
        if (!agentId.includes("/ralph-")) {
          state.parentCall = ctx.tools.execute("ralph_loop", { objective: "build it", max_rounds: 3 });
          return;
        }
        state.childQuestions.push(ctx.question);
        if (agentId.endsWith("/ralph-1")) {
          yield thought("STATUS: continue\nSUMMARY: part one");
        } else {
          yield thought("STATUS: complete\nSUMMARY: all done");
        }
      },
    };
    await collect(deps, testSpec(driver));
    if (state.parentCall === null) throw new Error("delegation never ran");
    const outcome = await state.parentCall;
    expect(outcome.result).toContain("[ralph complete after 2 round(s)]");
    expect(outcome.result).toContain("all done");
    expect(state.childQuestions).toHaveLength(2);
    expect(state.childQuestions[1]).toContain("part one");
  });

  it("stops blocked on unparseable round output", async () => {
    const state: RalphState = { parentCall: null, childCalls: [], childQuestions: [] };
    const deps = testDeps();
    const driver: AgentDriver = {
      frameworkId: "ralph-stub",
      displayName: "RalphStub",
      async *run(ctx: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
        if (!ctx.identity.agentId.includes("/ralph-")) {
          state.parentCall = ctx.tools.execute("ralph_loop", { objective: "build it" });
          return;
        }
        yield thought("just some wandering text");
      },
    };
    await collect(deps, testSpec(driver));
    if (state.parentCall === null) throw new Error("delegation never ran");
    const outcome = await state.parentCall;
    expect(outcome.result).toContain("[ralph blocked after 1 round(s)]");
    expect(outcome.result).toContain("wandering");
  });

  it("stops budget-limited when rounds run out", async () => {
    const state: RalphState = { parentCall: null, childCalls: [], childQuestions: [] };
    const deps = testDeps();
    const driver: AgentDriver = {
      frameworkId: "ralph-stub",
      displayName: "RalphStub",
      async *run(ctx: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
        if (!ctx.identity.agentId.includes("/ralph-")) {
          state.parentCall = ctx.tools.execute("ralph_loop", { objective: "build it", max_rounds: 2 });
          return;
        }
        state.childQuestions.push(ctx.question);
        yield thought("STATUS: continue\nSUMMARY: still going");
      },
    };
    await collect(deps, testSpec(driver));
    if (state.parentCall === null) throw new Error("delegation never ran");
    const outcome = await state.parentCall;
    expect(outcome.result).toContain("[ralph budget-limited after 2 round(s)]");
    expect(state.childQuestions).toHaveLength(2);
  });

  it("withholds delegation tools from rounds and rejects blank objectives", async () => {
    const deps = testDeps();
    const state = { nested: null as Promise<ToolExecutionResult> | null, blank: null as Promise<ToolExecutionResult> | null };
    const driver: AgentDriver = {
      frameworkId: "ralph-stub",
      displayName: "RalphStub",
      async *run(ctx: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
        if (!ctx.identity.agentId.includes("/ralph-")) {
          state.blank = ctx.tools.execute("ralph_loop", { objective: "  " });
          return;
        }
        state.nested = ctx.tools.execute("ralph_loop", { objective: "deeper" });
        yield thought("STATUS: complete\nSUMMARY: one");
      },
    };
    // Blank objective fails before any round starts.
    await collect(deps, testSpec(driver));
    if (state.blank === null) throw new Error("driver never ran");
    expect((await state.blank).ok).toBe(false);

    // A real round cannot re-enter the loop.
    const deps2 = testDeps();
    const state2 = { parent: null as Promise<ToolExecutionResult> | null, nested: null as Promise<ToolExecutionResult> | null };
    const driver2: AgentDriver = {
      frameworkId: "ralph-stub",
      displayName: "RalphStub",
      async *run(ctx: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
        if (!ctx.identity.agentId.includes("/ralph-")) {
          state2.parent = ctx.tools.execute("ralph_loop", { objective: "build it" });
          return;
        }
        state2.nested = ctx.tools.execute("ralph_loop", { objective: "deeper" });
        yield thought("STATUS: complete\nSUMMARY: one");
      },
    };
    await collect(deps2, testSpec(driver2));
    if (state2.nested === null) throw new Error("round never ran");
    const nested = await state2.nested;
    expect(nested.ok).toBe(false);
    expect(nested.code).toBe("unknown_tool");
  });
});
