/**
 * @file subagent tests
 * @description Locks nested delegation: answers, depth cap, failure honesty, shared workspace.
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

/** Parent delegates once; child answers, probes depth, and writes a shared file. */
function delegatingDriver(state: {
  parentCall: Promise<ToolExecutionResult> | null;
  childCall: Promise<ToolExecutionResult> | null;
}): AgentDriver {
  return {
    frameworkId: "delegation-stub",
    displayName: "DelegationStub",
    async *run(ctx: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
      if (!ctx.identity.agentId.endsWith("/sub")) {
        state.parentCall = ctx.tools.execute("subagent", { task: "do the thing" });
        return;
      }
      state.childCall = ctx.tools.execute("subagent", { task: "go deeper" });
      await ctx.tools.execute("write", { path: "from-child.txt", content: "child was here" });
      yield thought("child answer");
    },
  };
}

describe("runAgentExecution subagent delegation", () => {
  it("returns the child answer, caps depth, and shares the workspace", async () => {
    const state: { parentCall: Promise<ToolExecutionResult> | null; childCall: Promise<ToolExecutionResult> | null } = {
      parentCall: null,
      childCall: null,
    };
    const deps = testDeps();
    const events = await collect(deps, testSpec(delegatingDriver(state)));
    if (state.parentCall === null || state.childCall === null) throw new Error("delegation never ran");
    const parentOutcome = await state.parentCall;
    expect(parentOutcome.ok).toBe(true);
    expect(parentOutcome.result).toContain("child answer");
    // Depth 1 cannot re-delegate: the nested registry has no subagent at all.
    const grandchild = await state.childCall;
    expect(grandchild.ok).toBe(false);
    expect(grandchild.code).toBe("unknown_tool");
    // Same workspace: the child's file is visible through the parent registry.
    const complete = events.filter((event) => event.type === "complete");
    expect(complete).toHaveLength(1);
    const workspaceName = (complete[0] as { workspace: string }).workspace;
    expect(deps.workspaceRegistry.get(workspaceName)?.fs.readFile("from-child.txt")).toBe("child was here");
  });

  it("reports child failure honestly instead of throwing", async () => {
    let result = "";
    const probe: AgentDriver = {
      frameworkId: "probe-stub",
      displayName: "ProbeStub",
      async *run(ctx: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
        if (!ctx.identity.agentId.endsWith("/sub")) {
          const outcome = await ctx.tools.execute("subagent", { task: "blow up" });
          result = outcome.result;
        } else {
          throw new Error("boom");
        }
      },
    };
    const deps = testDeps();
    await collect(deps, testSpec(probe));
    // Nested driver errors pass through the anti-leak sanitizer (name only),
    // exactly like top-level run failures: honesty without internals.
    expect(result).toContain("(subagent failed: Error)");
  });

  it("rejects blank tasks fail-closed", async () => {
    const deps = testDeps();
    // Object property (not a closure-captured let): TS keeps the declared union
    // instead of freezing the initializer narrowing (see test 1 pattern).
    const state: { call: Promise<ToolExecutionResult> | null } = { call: null };
    await collect(
      deps,
      testSpec({
        frameworkId: "stub",
        displayName: "Stub",
        async *run(ctx: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
          state.call = ctx.tools.execute("subagent", { task: "  " });
        },
      }),
    );
    if (state.call === null) throw new Error("driver never ran");
    const outcome = await state.call;
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("workspace_error");
  });
});

describe("runAgentExecution subagent abort parity", () => {
  it("rethrows AbortError instead of memoizing cancellation", async () => {
    const deps = testDeps();
    const controller = new AbortController();
    let failure: unknown = null;
    // Abort lands mid-flight (from inside the nested run): the registry pre-check
    // at call time sees a live signal, so only the post-nested check can propagate.
    const driver: AgentDriver = {
      frameworkId: "stub",
      displayName: "Stub",
      async *run(ctx: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
        if (!ctx.identity.agentId.endsWith("/sub")) {
          try {
            await ctx.tools.execute("subagent", { task: "do it" });
          } catch (error) {
            failure = error;
          }
        } else {
          controller.abort();
        }
      },
    };
    await collect(deps, testSpec(driver, { signal: controller.signal }));
    expect((failure as Error | null)?.name).toBe("AbortError");
  });
});

describe("runAgentExecution subagent fork mode", () => {
  it("forks inherit the parent transcript while spawns start blank", async () => {
    const seen: { spawnHistory: number; forkHistory: number; forkQuestion: string } = {
      spawnHistory: -1,
      forkHistory: -1,
      forkQuestion: "",
    };
    const driver: AgentDriver = {
      frameworkId: "fork-probe",
      displayName: "ForkProbe",
      async *run(ctx: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
        if (ctx.identity.agentId.endsWith("/sub")) {
          if (ctx.question === "forked job") {
            seen.forkHistory = ctx.history.length;
            seen.forkQuestion = ctx.question;
          } else {
            seen.spawnHistory = ctx.history.length;
          }
          yield thought("child done");
          return;
        }
        await ctx.tools.execute("subagent", { task: "blank job" });
        await ctx.tools.execute("subagent", { task: "forked job", mode: "fork" });
      },
    };
    const deps = testDeps();
    const parentHistory = [
      { role: "user", content: "parent q" },
      { role: "assistant", content: "parent a" },
    ] as Array<{ role: "user" | "assistant"; content: string }>;
    await collect(deps, testSpec(driver, { history: parentHistory, question: "current parent question" }));
    // Spawn: blank history. Fork: parent turns plus the current question as grounding.
    expect(seen.spawnHistory).toBe(0);
    expect(seen.forkHistory).toBe(parentHistory.length + 1);
    expect(seen.forkQuestion).toBe("forked job");
  });

  it("marks forked answers with provenance", async () => {
    let result = "";
    const driver: AgentDriver = {
      frameworkId: "fork-mark",
      displayName: "ForkMark",
      async *run(ctx: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
        if (!ctx.identity.agentId.endsWith("/sub")) {
          const outcome = await ctx.tools.execute("subagent", { task: "job", mode: "fork" });
          result = outcome.result;
        } else {
          yield thought("answer text");
        }
      },
    };
    await collect(testDeps(), testSpec(driver));
    expect(result).toContain("[forked context]");
    expect(result).toContain("answer text");
  });
});
