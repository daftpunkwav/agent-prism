/**
 * @file matrix test
 * @description Locks matrix tabulation and markdown rendering.
 */
import { describe, expect, it } from "vitest";
import { renderMatrixReport, tabulateCell } from "../src/matrix.js";

describe("tabulateCell", () => {
  it("counts passes over verdicts", () => {
    expect(tabulateCell({})).toEqual({ passed: 0, total: 0 });
    expect(
      tabulateCell({
        a: { passed: true, reason: "", details: [] },
        b: { passed: false, reason: "", details: [] },
      }),
    ).toEqual({ passed: 1, total: 2 });
  });
});

describe("renderMatrixReport", () => {
  it("renders sorted rows with scores", () => {
    const text = renderMatrixReport([
      {
        templateId: "loop_prime_race",
        dimension: "framework",
        selections: ["native", "plan_execute"],
        verdicts: {
          native: { passed: true, reason: "", details: [] },
          "plan-execute": { passed: false, reason: "", details: [] },
        },
      },
      {
        templateId: "context_long_tail",
        dimension: "context",
        selections: ["sliding"],
        verdicts: {},
      },
    ]);
    expect(text).toContain("| context_long_tail | context | sliding | n/a | - |");
    expect(text).toContain("1/2");
    expect(text.indexOf("context_long_tail")).toBeLessThan(text.indexOf("loop_prime_race"));
    expect(renderMatrixReport([])).toContain("(no cells)");
  });
});
