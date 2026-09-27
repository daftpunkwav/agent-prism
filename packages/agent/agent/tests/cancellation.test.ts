/**
 * @file cancellation tests
 * @description Locks the run-level cancellation contract of runAgentExecution.
 *
 * Responsibilities:
 * - Pin that a cancelled run never yields a successful terminal
 * - Pin that cancellation propagates to the caller instead of a failed-run event
 *
 * Cancellation is not a failure: the drivers translate it differently (throw
 * AbortError, or end a stream normally), so the classification happens once here
 * — the arena runner turns the propagated abort into the stopped column marker.
 */

import { describe, expect, it } from "vitest";
import type { AgentDriver, ArenaEvent } from "@agentprism/contracts";
import type { AgentExecutionContext } from "@agentprism/harness";
import { runAgentExecution } from "../src/agent-execution.js";
import { collect, testDeps, testSpec } from "./run-fixtures.js";

function completeSuccess(ctx: AgentExecutionContext): ArenaEvent {
  return {
    type: "complete",
    pipeline: ctx.config.label,
    workspace: ctx.workspace.name,
    content: "",
    tool: "",
    args: {},
    result: "",
    step: 1,
    passed: null,
    reason: "",
    metrics: {
      success: true,
      duration_ms: 1,
      input_tokens: 1,
      output_tokens: 1,
      total_tokens: 2,
      tool_calls: 0,
      steps: 1,
      context_window: 1,
      max_input_tokens: 1,
      max_output_tokens: 1,
      context_usage_pct: 0,
      input_usage_pct: 0,
    },
    message: "",
    token_stats: null,
    turn: ctx.turn,
    runId: ctx.identity.runId,
    timestamp: ctx.clock.now(),
  } as ArenaEvent;
}

describe("runAgentExecution cancellation", () => {
  it("never yields a successful terminal for a cancelled run", async () => {
    const deps = testDeps();
    const controller = new AbortController();
    let workspaceName = "";
    // A framework that ends its stream normally on cancel (LangGraph checks the
    // signal between nodes only) still must not produce a success terminal.
    const driver: AgentDriver = {
      frameworkId: "quiet-cancel",
      displayName: "QuietCancel",
      async *run(ctx: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
        workspaceName = ctx.workspace.name;
        controller.abort();
        yield {
          type: "thought",
          pipeline: ctx.config.label,
          workspace: ctx.workspace.name,
          content: "partial answer",
          turn: ctx.turn,
          runId: ctx.identity.runId,
          timestamp: ctx.clock.now(),
        } as ArenaEvent;
        yield completeSuccess(ctx);
      },
    };

    const events: ArenaEvent[] = [];
    let thrown: unknown = null;
    try {
      for await (const event of runAgentExecution(deps, testSpec(driver, { signal: controller.signal }))) {
        events.push(event);
      }
    } catch (error) {
      thrown = error;
    }

    expect((thrown as Error | null)?.name).toBe("AbortError");
    expect(events.some((event) => event.type === "complete" && event.metrics?.success === true)).toBe(false);
    // The cancel path still releases the workspace protection mark (finally).
    expect(deps.workspaceRegistry.protectedCount(workspaceName)).toBe(0);
  });

  it("propagates a driver abort instead of converging it into a failed run", async () => {
    const deps = testDeps();
    const controller = new AbortController();
    // Abort lands mid-run; the driver's in-flight call throws AbortError.
    const driver: AgentDriver = {
      frameworkId: "throwing-cancel",
      displayName: "ThrowingCancel",
      async *run(): AsyncGenerator<ArenaEvent> {
        controller.abort();
        const aborted = new Error("Aborted");
        aborted.name = "AbortError";
        throw aborted;
      },
    };

    const events: ArenaEvent[] = [];
    let thrown: unknown = null;
    try {
      for await (const event of runAgentExecution(deps, testSpec(driver, { signal: controller.signal }))) {
        events.push(event);
      }
    } catch (error) {
      thrown = error;
    }

    // No error/complete pair: the caller owns the cancelled terminal.
    expect((thrown as Error | null)?.name).toBe("AbortError");
    expect(events).toEqual([]);
  });

  it("keeps converging a failure when the signal was never aborted", async () => {
    const deps = testDeps();
    const driver: AgentDriver = {
      frameworkId: "plain-failure",
      displayName: "PlainFailure",
      async *run(): AsyncGenerator<ArenaEvent> {
        throw new Error("boom");
      },
    };
    const events = await collect(deps, testSpec(driver));
    expect(events.some((event) => event.type === "error")).toBe(true);
    expect(events.at(-1)?.type).toBe("complete");
    expect(events.at(-1)?.metrics?.success).toBe(false);
  });
});
