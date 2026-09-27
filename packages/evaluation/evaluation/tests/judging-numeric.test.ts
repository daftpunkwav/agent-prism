/**
 * @file numeric judging tests
 * @description Locks the numeric judge: extraction, matching strategy, tolerance.
 *
 * Responsibilities:
 * - Pin that an answer carrying the right value passes even when it shows work
 * - Pin the explicit "last" strategy for specs that require the concluding number
 * - Pin operator/tolerance handling and the empty-answer case
 */

import { describe, expect, it } from "vitest";
import { JudgeSpecSchema } from "@agentprism/contracts";
import { judgeAnswers } from "../src/judging.js";

/** Public entry point returns a map; these cases judge one answer. */
function verdictOf(answer: string, judgeSpec: ReturnType<typeof JudgeSpecSchema.parse>) {
  return judgeAnswers({ col: answer }, judgeSpec).col!;
}

const spec = (overrides: Record<string, unknown> = {}) =>
  JudgeSpecSchema.parse({ type: "numeric", operator: "==", value: 384, tolerance: 0.001, ...overrides });

describe("numeric judging", () => {
  it("passes a bare number", () => {
    expect(verdictOf("384", spec()).passed).toBe(true);
  });

  it("passes when the answer shows work but reaches the right value", () => {
    // The templates ask for the number only; a column that explains itself is still
    // scored on the value it reached (verbosity shows up in token metrics instead).
    expect(verdictOf("(128 + 64) * 2 = 384", spec()).passed).toBe(true);
    expect(verdictOf("17! = 355687428096000", spec({ value: 355687428096000, tolerance: 1 })).passed).toBe(true);
    expect(verdictOf("seq 1 2000 | tail -n 1 → 2000", spec({ value: 2000 })).passed).toBe(true);
    expect(verdictOf("最后一行是 2000，序列从 1 开始", spec({ value: 2000 })).passed).toBe(true);
  });

  it("fails a wrong value and says what it saw", () => {
    const verdict = verdictOf("(128 + 64) * 2 = 400", spec());
    expect(verdict.passed).toBe(false);
    expect(verdict.reason).toContain("no extracted number satisfies");
    // The details list every candidate, so a failure is diagnosable.
    expect(verdict.details.join(" ")).toContain("400");
  });

  it("finds no number in a non-numeric answer", () => {
    const verdict = verdictOf("forty-two", spec());
    expect(verdict.passed).toBe(false);
    expect(verdict.reason).toContain("No number extracted");
  });

  it("honours the explicit last-number strategy", () => {
    const last = spec({ numeric_match: "last", value: 2000 });
    expect(verdictOf("the last line was 2000", last).passed).toBe(true);
    // A trailing aside reorders the numbers: with "last" the concluding value decides.
    expect(verdictOf("最后一行是 2000，序列从 1 开始", last).passed).toBe(false);
    // ...and the default keeps accepting it.
    expect(verdictOf("最后一行是 2000，序列从 1 开始", spec({ value: 2000 })).passed).toBe(true);
  });

  it("applies tolerance and operators", () => {
    expect(verdictOf("384.0005", spec()).passed).toBe(true);
    expect(verdictOf("383", spec({ operator: "<=", value: 384 })).passed).toBe(true);
    expect(verdictOf("385", spec({ operator: ">", value: 384 })).passed).toBe(true);
    expect(verdictOf("383", spec({ operator: ">", value: 384 })).passed).toBe(false);
  });

  it("folds thousands separators but keeps decimal commas meaningful", () => {
    expect(verdictOf("1,234", spec({ value: 1234 })).passed).toBe(true);
    // "1,5" is a European decimal; folding it blindly produced 15.
    expect(verdictOf("1,5", spec({ value: 15 })).passed).toBe(false);
  });
});
