/**
 * @file prompt-profiles test
 * @description Locks the per-profile prompt shapes assembled from builtin sections.
 */
import { describe, expect, it } from "vitest";
import { buildPromptParts } from "../src/prompt/prompt-builder.js";

const BASE_INPUTS = {
  question: "do the task",
  reasoning: "react",
  harness: "bare",
  context: "sliding",
} as const;

describe("buildPromptParts profiles", () => {
  it("keeps zero-shot free of examples and suffixes", () => {
    const parts = buildPromptParts({ ...BASE_INPUTS, profile: "zero_shot" });
    expect(parts.system).not.toContain("Example");
    expect(parts.user).toBe("do the task");
  });

  it("builds few-shot from three complete demonstrations", () => {
    const parts = buildPromptParts({ ...BASE_INPUTS, profile: "few_shot" });
    expect(parts.system).toContain("[Few-shot examples]");
    expect(parts.system).toContain("Example 1");
    expect(parts.system).toContain("Example 2");
    expect(parts.system).toContain("Example 3");
    // Each demonstration carries a task, tool sequence, and verified final line.
    expect(parts.system.match(/Task: /g)?.length).toBe(3);
    expect(parts.system.match(/Final: artifact/g)?.length).toBe(3);
  });

  it("appends the chain-of-thought suffix to the user text", () => {
    const parts = buildPromptParts({ ...BASE_INPUTS, profile: "cot_prompt" });
    expect(parts.user).toContain("Let's think step by step.");
  });

  it("states the structured JSON contract in the system prompt", () => {
    const parts = buildPromptParts({ ...BASE_INPUTS, profile: "structured" });
    expect(parts.system).toContain('"plan"');
    expect(parts.system).toContain('"files"');
    expect(parts.system).toContain('"how_to_run"');
  });

  it("keeps terse prompts minimal", () => {
    const parts = buildPromptParts({ ...BASE_INPUTS, profile: "terse" });
    expect(parts.system).toContain("Keep prose minimal");
    expect(parts.user).toContain("Be concise.");
  });
});
