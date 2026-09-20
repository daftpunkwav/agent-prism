/**
 * @file structured-finalize agent-level test
 * @description Locks finalize ordering: normalized answer lands before the terminal complete.
 */
import { describe, expect, it } from "vitest";
import type { AgentDriver, ArenaEvent, ColumnRuntime, LlmAdapter } from "@agentprism/contracts";
import { extractAnswerFromEvents, PipelineConfigSchema } from "@agentprism/contracts";
import { collect, testDeps, testSpec } from "./run-fixtures.js";

const NORMALIZED_JSON = '{"plan":"p","files":["a.py"],"how_to_run":"python a.py"}';

/** Stub LLM whose invoke returns the normalized JSON (the finalize call). */
function finalizeLlm(): LlmAdapter {
  return {
    invoke: async () => ({ text: NORMALIZED_JSON, toolCalls: [] }),
    stream: async function* () {},
  };
}

/** Driver stub emitting a raw answer thought and then its own terminal complete. */
function driverWith(completeSuccess: boolean): AgentDriver {
  return {
    frameworkId: "stub",
    displayName: "Stub",
    async *run(): AsyncGenerator<ArenaEvent> {
      yield {
        type: "step_start", pipeline: "col", workspace: "", content: "",
        tool: "", args: {}, result: "", step: 1, passed: null, reason: "",
        metrics: null, message: "", token_stats: null, turn: 0, runId: "", timestamp: 0,
      };
      yield {
        type: "thought", pipeline: "col", workspace: "", content: "raw answer",
        tool: "", args: {}, result: "", step: 1, passed: null, reason: "",
        metrics: null, message: "", token_stats: null, turn: 0, runId: "", timestamp: 0,
      };
      yield {
        type: "complete", pipeline: "col", workspace: "", content: "",
        tool: "", args: {}, result: "", step: 1, passed: null, reason: "",
        metrics: {
          success: completeSuccess, duration_ms: 1, input_tokens: 0, output_tokens: 0,
          total_tokens: 0, tool_calls: 0, steps: 1, context_window: 128000,
          max_input_tokens: 120000, max_output_tokens: 96000,
          context_usage_pct: 0, input_usage_pct: 0,
        },
        message: "", token_stats: null, turn: 0, runId: "", timestamp: 0,
      };
    },
  };
}

function specWith(driver: AgentDriver, llm: LlmAdapter, profile: string) {
  const columnRuntime: ColumnRuntime = {
    llm,
    llmVendor: null,
    contextWindow: 128000,
    maxInputTokens: 120000,
  };
  return testSpec(driver, {
    columnRuntime,
    config: PipelineConfigSchema.parse({ label: "col", harness: "bare", prompt_profile: profile }),
  });
}

describe("structured finalize ordering", () => {
  it("emits the normalized answer before the held-back terminal complete", async () => {
    const events = await collect(testDeps(), specWith(driverWith(true), finalizeLlm(), "structured"));
    const finalizeThoughtIndex = events.findIndex(
      (event) => event.type === "thought" && event.content.includes("[Structured final answer]"),
    );
    const completeIndex = events.findIndex((event) => event.type === "complete");
    expect(finalizeThoughtIndex).toBeGreaterThan(-1);
    expect(completeIndex).toBeGreaterThan(finalizeThoughtIndex);
    // The finalize step_start precedes its thought; extraction reads the JSON.
    expect(events[finalizeThoughtIndex - 1]?.type).toBe("step_start");
    expect(extractAnswerFromEvents(events)).toContain('"plan"');
    // The finalize turn folds into the terminal metrics.
    const complete = events[completeIndex] as (typeof events)[number];
    expect(complete.metrics?.steps).toBe(2);
  });

  it("skips the finalize (and extra calls) when the terminal complete is a failure", async () => {
    const llm = finalizeLlm();
    let invokes = 0;
    llm.invoke = async () => {
      invokes += 1;
      return { text: NORMALIZED_JSON, toolCalls: [] };
    };
    const events = await collect(testDeps(), specWith(driverWith(false), llm, "structured"));
    expect(invokes).toBe(0);
    expect(events.some((event) => event.content.includes("[Structured final answer]"))).toBe(false);
    // Exactly one terminal complete, still delivered.
    expect(events.filter((event) => event.type === "complete")).toHaveLength(1);
  });

  it("runs nothing extra when the profile is not structured", async () => {
    const llm = finalizeLlm();
    let invokes = 0;
    llm.invoke = async () => {
      invokes += 1;
      return { text: NORMALIZED_JSON, toolCalls: [] };
    };
    const events = await collect(testDeps(), specWith(driverWith(true), llm, "zero_shot"));
    expect(invokes).toBe(0);
    expect(extractAnswerFromEvents(events)).toBe("raw answer");
    expect(events.filter((event) => event.type === "complete")).toHaveLength(1);
  });
});
