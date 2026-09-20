/**
 * @file matrix
 * @description Comparison-matrix aggregation: per-cell verdicts into markdown tables.
 *
 * Responsibilities:
 * - Reduce per-column judge verdicts into pass/total cells
 * - Render multi-cell matrices as diffable markdown tables
 *
 * Pure over caller-supplied verdicts: cell execution (runs, judging) lives in
 * the matrix script / transport layer, never here. Markdown keeps the output
 * committable as run artifacts without a renderer.
 */

import type { JudgeResult } from "@agentprism/contracts";

/** One matrix cell: a template × dimension comparison with verdicts. */
export interface MatrixCellView {
  templateId: string;
  dimension: string;
  selections: string[];
  /** Column label to judge verdict. */
  verdicts: Record<string, JudgeResult>;
}

/** Pass/total rollup for one cell. */
export function tabulateCell(verdicts: Record<string, JudgeResult>): { passed: number; total: number } {
  const values = Object.values(verdicts);
  return { passed: values.filter((verdict) => verdict.passed).length, total: values.length };
}

/**
 * Renders matrix cells as a markdown table (stable column order, sorted rows).
 * Cells with zero verdicts render as `n/a` (never 0/0).
 */
export function renderMatrixReport(cells: MatrixCellView[]): string {
  if (cells.length === 0) return "# Comparison matrix\n\n(no cells)\n";
  const ordered = [...cells].sort(
    (a, b) => a.templateId.localeCompare(b.templateId) || a.dimension.localeCompare(b.dimension),
  );
  const lines = [
    "# Comparison matrix",
    "",
    "| template | dimension | selections | score | columns |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const cell of ordered) {
    const { passed, total } = tabulateCell(cell.verdicts);
    const score = total === 0 ? "n/a" : `${passed}/${total}`;
    const columns = Object.keys(cell.verdicts)
      .sort()
      .map((label) => `${label}=${cell.verdicts[label]?.passed === true ? "pass" : "FAIL"}`)
      .join(", ");
    lines.push(`| ${cell.templateId} | ${cell.dimension} | ${cell.selections.join("+")} | ${score} | ${columns || "-"} |`);
  }
  return lines.join("\n") + "\n";
}
