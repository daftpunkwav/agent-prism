/**
 * @file ArenaRunRequestSchema tests
 * @description Locks the request schema's baseline wire format.
 *
 * Responsibilities:
 * - Pin the accepted request shape end to end
 */

/**
 * Regression: Arena run baseline is submitted as option tokens (strings) from
 * the web baseline panel / meta defaults; the request schema must accept them
 * before resolveBaselineOverrides coerces numeric fields.
 */
import { describe, expect, it } from "vitest";
import { ArenaRunRequestSchema, PipelineConfigSchema } from "@agentprism/contracts";

describe("ArenaRunRequestSchema baseline wire format", () => {
  it("accepts string option tokens for decode numeric fields", () => {
    const parsed = ArenaRunRequestSchema.safeParse({
      question: "compare temperature",
      dimension: "framework",
      selections: ["native", "langgraph"],
      baseline: {
        temperature: "0.7",
        top_p: "1",
        frequency_penalty: "0",
        presence_penalty: "0",
        max_output_tokens: "2048",
        max_steps: "10",
        reasoning: "react",
      },
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.baseline?.temperature).toBe("0.7");
    expect(parsed.data.baseline?.max_output_tokens).toBe("2048");
    expect(parsed.data.baseline?.max_steps).toBe("10");
  });

  it("keeps thinking_budget and dynamic context ids on the wire", () => {
    // Regression: a missing wire key let zod silently strip the baseline
    // panel's thinking_budget, and the closed context enum rejected
    // registered context-strategy plugin ids (both fields are served as
    // baseline selects/inputs via /meta baseline_fields).
    const parsed = ArenaRunRequestSchema.safeParse({
      question: "compare thinking budgets",
      dimension: "model",
      selections: [],
      baseline: { thinking_budget: "8192", context: "some_registered_plugin" },
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.baseline?.thinking_budget).toBe("8192");
    expect(parsed.data.baseline?.context).toBe("some_registered_plugin");
  });

  it("accepts independent column_sessions keyed by pipeline label", () => {
    const parsed = ArenaRunRequestSchema.safeParse({
      question: "add a scoreboard",
      dimension: "framework",
      selections: ["native", "langchain"],
      column_sessions: {
        "Native Agent": {
          workspace: "Native_Agent_1_abc123",
          messages: [
            { role: "user", content: "write snake" },
            { role: "assistant", content: "created snake.py" },
          ],
        },
        LangChain: {
          workspace: "LangChain_1_def456",
          messages: [
            { role: "user", content: "write snake" },
            { role: "assistant", content: "used a different layout" },
          ],
        },
      },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.column_sessions?.["Native Agent"]?.workspace).toBe("Native_Agent_1_abc123");
    expect(parsed.data.column_sessions?.LangChain?.messages).toHaveLength(2);
  });

  it("rejects a column session whose transcript is not user/assistant pairs", () => {
    const parsed = ArenaRunRequestSchema.safeParse({
      question: "hello",
      column_sessions: {
        Native: {
          messages: [{ role: "assistant", content: "orphan" }],
        },
      },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("PipelineConfigSchema max_steps budget", () => {
  it("accepts any in-range integer and the -1 unlimited sentinel", () => {
    expect(PipelineConfigSchema.safeParse({ max_steps: 7 }).success).toBe(true);
    expect(PipelineConfigSchema.safeParse({ max_steps: 100_000 }).success).toBe(true);
    expect(PipelineConfigSchema.safeParse({ max_steps: -1 }).success).toBe(true);
    expect(PipelineConfigSchema.safeParse({}).success).toBe(true);
  });

  it("rejects zero, negatives other than -1, and values above the ceiling", () => {
    expect(PipelineConfigSchema.safeParse({ max_steps: 0 }).success).toBe(false);
    expect(PipelineConfigSchema.safeParse({ max_steps: -2 }).success).toBe(false);
    expect(PipelineConfigSchema.safeParse({ max_steps: 100_001 }).success).toBe(false);
    expect(PipelineConfigSchema.safeParse({ max_steps: 1.5 }).success).toBe(false);
  });
});
