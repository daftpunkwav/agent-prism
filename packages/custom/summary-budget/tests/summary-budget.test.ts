/**
 * @file summary-budget tests
 * @description Locks the summary-budget dimension: option set, token→char
 * conversion against the run's divisor, and the descriptor shape.
 */

import { describe, expect, it } from "vitest";
import { summaryBudgetDimension, summaryMaxCharsFor } from "../src/index.js";

describe("summaryMaxCharsFor", () => {
  it("converts token values with the run's char-per-token divisor", () => {
    expect(summaryMaxCharsFor("5000", {})).toBe(20_000);
    expect(summaryMaxCharsFor("8000", { charsPerToken: 2 })).toBe(16_000);
    expect(summaryMaxCharsFor("2000", { charsPerToken: 6 })).toBe(12_000);
  });

  it("returns 0 for a value it cannot read (the hook then leaves the cap alone)", () => {
    expect(summaryMaxCharsFor("", {})).toBe(0);
    expect(summaryMaxCharsFor("nonsense", {})).toBe(0);
  });
});

describe("summaryBudgetDimension", () => {
  it("declares token-denominated options with a declared default", () => {
    expect(summaryBudgetDimension.id).toBe("summary_budget");
    expect(summaryBudgetDimension.options.map((option) => option.value)).toEqual(["2000", "5000", "8000"]);
    expect(summaryBudgetDimension.default).toBe("5000");
    expect(summaryBudgetDimension.options.every((option) => option.label !== "")).toBe(true);
  });

  it("tags the prompt with the selected value", () => {
    expect(summaryBudgetDimension.promptHint).toContain("{value}");
  });

  it("raises the summary digest cap for a larger budget", () => {
    const hook = summaryBudgetDimension.hooks?.contextTuning;
    if (hook === undefined) throw new Error("summary budget must expose a contextTuning hook");
    const small = hook("2000", { summaryMaxChars: 4000 });
    const large = hook("8000", { summaryMaxChars: 4000 });
    expect(small?.summaryMaxChars).toBe(8000);
    expect(large?.summaryMaxChars).toBe(32_000);
    expect(Number(large?.summaryMaxChars)).toBeGreaterThan(Number(small?.summaryMaxChars));
  });
});
