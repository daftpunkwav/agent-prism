// @vitest-environment jsdom
/**
 * @file comparison report tests
 * @description Locks the report renderer: verdict chips, metrics table, answers, ablation, narrative.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComparisonReportPayload } from "@agentprism/client";
import type { ColumnState } from "@agentprism/arena-view";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { ComparisonReport } from "../src/app/arena/ComparisonReport.js";

function col(label: string, overrides?: Partial<ColumnState>): ColumnState {
  return {
    label,
    frameworkId: "native",
    events: [
      { type: "thought", content: `${label} final answer`, turn: 1, step: 1 },
      { type: "action", tool: "read", args: { path: "src/a.ts" }, turn: 1, step: 2 },
    ],
    metrics: { success: true, duration_ms: 1500, total_tokens: 4200, tool_calls: 2, steps: 3 },
    ...overrides,
  } as unknown as ColumnState;
}

const REPORT = {
  question: "Why do columns differ?",
  narrative: "The columns diverge on tool choice.\n\n[Ablation] tool_calls A=2 B=1",
  ablation: {
    rows: [
      { label: "Native", tool_calls: 2, mcp_calls: 1, mcp_share: 0.5, skill_reads: 0, reflects: 1, answer_chars: 120, trajectory_score: 0.8, judge_passed: true },
    ],
  },
  columns: {
    Native: { artifacts: { file_count: 2, files: ["a.ts", "b.ts"], tree: "src/", snippets: { "src/a.ts": "const a = 1;" } }, steps: "step one" },
  },
  trajectories: { Native: { overall: 0.8, passed: true, summary: "solid trajectory", dimensions: [{ dimension: "tools", score: 0.9 }] } },
} as unknown as ComparisonReportPayload;

afterEach(cleanup);

function renderReport(props: { columns?: Record<string, ColumnState>; report?: ComparisonReportPayload | null } = {}) {
  return render(
    <I18nProvider initialLocale="en">
      <ComparisonReport
        columns={props.columns ?? { Native: col("Native"), LangChain: col("LangChain", { metrics: { success: false, duration_ms: 3000, total_tokens: 2000, tool_calls: 1, steps: 2 } } as unknown as ColumnState) }}
        report={props.report === undefined ? REPORT : props.report}
      />
    </I18nProvider>,
  );
}

const en = () => getCatalog("en").arena.report;

describe("ComparisonReport", () => {
  it("renders nothing when no column has settled metrics", () => {
    const { container } = renderReport({ columns: { Native: { label: "Native", frameworkId: "native", events: [] } as ColumnState } });
    expect(container.firstElementChild).toBeNull();
  });

  it("renders the verdict chips where columns differ and the judge tally", () => {
    renderReport({
      columns: {
        Native: col("Native", { judge: { passed: true, reason: "ok", details: [] } } as unknown as Partial<ColumnState>),
        LangChain: col("LangChain", { metrics: { success: false, duration_ms: 3000, total_tokens: 2000, tool_calls: 1, steps: 2 } } as unknown as ColumnState),
      },
    });
    expect(screen.getByText(en().verdictTitle)).toBeDefined();
    // Duration and token metrics differ between the two columns → chips.
    expect(document.querySelectorAll(".report-verdict-chip").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("1 / 1").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the metrics table with best-marks, status, and judge column", () => {
    renderReport();
    expect(screen.getByText(en().title)).toBeDefined();
    expect(screen.getByText("1500ms")).toBeDefined();
    expect(screen.getAllByText(en().success).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(en().failed).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(en().fastestMark).length).toBeGreaterThanOrEqual(1);
  });

  it("renders per-column answers with the final text", () => {
    renderReport();
    expect(screen.getByText(en().answersTitle)).toBeDefined();
    expect(screen.getAllByText(/final answer/).length).toBeGreaterThanOrEqual(1);
  });

  it("renders the ablation table with trajectory and judge outcome", () => {
    renderReport();
    expect(screen.getByText(en().ablationTitle)).toBeDefined();
    expect(screen.getByText("80%")).toBeDefined();
    expect(screen.getByText("solid trajectory")).toBeDefined();
    expect(screen.getByText(/PASS/)).toBeDefined();
  });

  it("renders artifacts and the split narrative body", () => {
    renderReport();
    expect(screen.getByText(en().artifactsTitle)).toBeDefined();
    expect(screen.getByText("const a = 1;")).toBeDefined();
    expect(screen.getAllByText(/The columns diverge on tool choice./).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/\[Ablation\] tool_calls A=2 B=1/)).toBeDefined();
  });

  it("keeps the narrative empty-state when no report exists", () => {
    renderReport({ report: null });
    expect(screen.getByText(en().narrativeEmpty)).toBeDefined();
    expect(screen.queryByText(en().ablationTitle)).toBeNull();
  });
});
