/**
 * @file verification reflect tests
 * @description Covers failure-reflection strategy extraction and fallbacks.
 *
 * Responsibilities:
 * - Pin strategy/insight extraction from the reflection JSON
 * - Lock the parse-failure and model-failure fallback strategies
 */

import { describe, expect, it, vi } from "vitest";
import { reflectOnFailure } from "../../src/verification/reflect.js";

function llmReplying(text: string) {
  return {
    invoke: vi.fn(async () => ({ text, usage: undefined })),
    stream: vi.fn(),
  };
}

describe("reflectOnFailure", () => {
  it("returns the strategy field when the model provides one", async () => {
    const llm = llmReplying('{"insight": "missing units", "strategy": "show units"}');
    expect(await reflectOnFailure("q", "41", "wrong", llm as never)).toBe("show units");
  });

  it("falls back to the insight when no strategy is given", async () => {
    const llm = llmReplying('{"insight": "answer too short"}');
    expect(await reflectOnFailure("q", "41", "incomplete", llm as never)).toBe("answer too short");
  });

  it("keeps the default strategy when the payload has neither field", async () => {
    const llm = llmReplying("{}");
    expect(await reflectOnFailure("q", "41", "wrong", llm as never)).toBe("Keep trying");
  });

  it("falls back when the reflection fails to parse or the model errors", async () => {
    const bad = llmReplying("{{{");
    expect(await reflectOnFailure("q", "41", "wrong", bad as never)).toContain("retry with the original strategy");

    const failing = {
      invoke: vi.fn(async () => {
        throw new Error("reflection exploded");
      }),
      stream: vi.fn(),
    };
    expect(await reflectOnFailure("q", "41", "wrong", failing as never)).toContain(
      "retry with the original strategy",
    );
  });
});
