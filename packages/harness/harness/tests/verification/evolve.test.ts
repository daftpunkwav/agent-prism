/**
 * @file verification evolve tests
 * @description Covers the self-evolution prompt-addition proposals.
 *
 * Responsibilities:
 * - Pin additions/reasoning extraction from the evolution JSON
 * - Lock the fail-open-to-empty behavior on parse and model failures
 */

import { describe, expect, it, vi } from "vitest";
import { proposeHarnessEdit } from "../../src/verification/evolve.js";

function llmReplying(text: string) {
  return {
    invoke: vi.fn(async () => ({ text, usage: undefined })),
    stream: vi.fn(),
  };
}

describe("proposeHarnessEdit", () => {
  it("returns the parsed prompt additions and reasoning", async () => {
    const llm = llmReplying('{"prompt_additions": ["always show units"], "reasoning": "unit drift"}');
    const proposal = await proposeHarnessEdit("q", "41", "missing units", "base prompt", llm as never);
    expect(proposal).toEqual({ prompt_additions: ["always show units"], reasoning: "unit drift" });
  });

  it("returns empty additions when the proposal fails to parse or the model errors", async () => {
    const bad = llmReplying("not json");
    expect(await proposeHarnessEdit("q", "41", "r", "p", bad as never)).toEqual({
      prompt_additions: [],
      reasoning: "Self-evolve parse failed",
    });

    const failing = {
      invoke: vi.fn(async () => {
        throw new Error("evolve exploded");
      }),
      stream: vi.fn(),
    };
    expect(await proposeHarnessEdit("q", "41", "r", "p", failing as never)).toEqual({
      prompt_additions: [],
      reasoning: "Self-evolve parse failed",
    });
  });

  it("rethrows user aborts instead of masking them as parse failures", async () => {
    const aborting = {
      invoke: vi.fn(async () => {
        throw Object.assign(new Error("stop now"), { name: "AbortError" });
      }),
      stream: vi.fn(),
    };
    await expect(proposeHarnessEdit("q", "41", "r", "p", aborting as never)).rejects.toThrow("stop now");
  });
});
