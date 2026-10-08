// @vitest-environment jsdom
/**
 * @file arena results grid tests
 * @description Locks the results grid: empty selection, placeholders, run cards, and inline ask windows.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { DimensionMeta } from "@agentprism/client";
import type { ColumnState } from "@agentprism/arena-view";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { ArenaResultsGrid } from "../src/app/arena/ArenaResultsGrid.js";

vi.mock("../src/app/arena/WorkspacePanel.js", () => ({
  WorkspacePanel: () => <div>workspace-panel-stub</div>,
}));

afterEach(cleanup);

const DIM = {
  id: "framework",
  label: "Framework",
  options: [
    { value: "native", label: "Native" },
    { value: "langchain", label: "LangChain" },
  ],
} as unknown as DimensionMeta;

type GridProps = Parameters<typeof ArenaResultsGrid>[0];

function baseProps(): GridProps {
  return {
    onStopColumn: vi.fn(),
    stoppingLabels: {},
    onUseAsSeed: vi.fn(),
    workspaceRefreshToken: 0,
    pendingAsksByLabel: {},
    askSubmitting: false,
    onAskAnswer: vi.fn(async () => true),
    onAskDismiss: vi.fn(),
    viewMode: "all",
    allPageSize: 4,
    pagedPageSize: 2,
    resolveDisplayLabel: (label: string) => label,
  } as unknown as GridProps;
}

function renderGrid(props: Partial<GridProps>) {
  return render(
    <I18nProvider initialLocale="en">
      <ArenaResultsGrid {...{ ...baseProps(), ...props }} />
    </I18nProvider>,
  );
}

const colCard = (label: string): ColumnState =>
  ({ label, frameworkId: "native", events: [] }) as ColumnState;

describe("ArenaResultsGrid", () => {
  it("shows the empty-selection state when nothing is selected", () => {
    const { container } = renderGrid({ activeDim: DIM, activeSelections: [], columns: {}, columnList: [], columnCount: 0, placeholderLabels: [], running: false, historySeedLabel: null });
    expect(screen.getByText(getCatalog("en").arena.results.emptySelection)).toBeDefined();
    expect(container.querySelector(".arena-columns")).toBeNull();
  });

  it("renders placeholders for selected options before events arrive", () => {
    const { container } = renderGrid({ activeDim: DIM, activeSelections: ["native", "langchain"], columns: {}, columnList: [], columnCount: 0, placeholderLabels: [], running: false, historySeedLabel: null });
    expect(container.querySelectorAll(".column-card-placeholder")).toHaveLength(2);
    // data-count carries the per-page cap (default 4), not the selected count.
    expect(container.querySelector(".arena-columns")?.getAttribute("data-count")).toBe("4");
  });

  it("renders run cards for columns keyed by option label", () => {
    const { container } = renderGrid({
      activeDim: DIM,
      activeSelections: ["native", "langchain"],
      columns: { Native: colCard("Native") },
      columnList: [],
      columnCount: 0,
      placeholderLabels: [],
      running: false,
      historySeedLabel: null,
    });
    // The card's display label resolves through the locale overlay; count cards instead.
    expect(container.querySelectorAll(".column-card-placeholder")).toHaveLength(1);
    expect(container.querySelectorAll(".column-card:not(.column-card-placeholder)")).toHaveLength(1);
  });

  it("falls back to columnList when no dimension is active", () => {
    const { container } = renderGrid({
      activeDim: null,
      activeSelections: [],
      columns: {},
      columnList: [colCard("Native"), colCard("LangChain")],
      columnCount: 2,
      placeholderLabels: [],
      running: false,
      historySeedLabel: null,
    });
    expect(container.querySelectorAll(".column-card")).toHaveLength(2);
  });

  it("shows fresh placeholders from placeholderLabels before the first run", () => {
    const { container } = renderGrid({
      activeDim: null,
      activeSelections: [],
      columns: {},
      columnList: [],
      columnCount: 2,
      placeholderLabels: ["Native", "LangChain"],
      running: false,
      historySeedLabel: null,
    });
    expect(container.querySelectorAll(".column-card-placeholder")).toHaveLength(2);
  });

  it("overlays the inline ask window on its column", () => {
    renderGrid({
      activeDim: DIM,
      activeSelections: ["native"],
      columns: { Native: colCard("Native") },
      columnList: [],
      columnCount: 0,
      placeholderLabels: [],
      running: true,
      historySeedLabel: null,
      pendingAsksByLabel: {
        Native: { sourceLabel: "Native", agentId: "agent-1", questions: [{ id: "q1", header: "", question: "Proceed?", options: [] }] },
      },
    });
    expect(screen.getByRole("dialog", { name: getCatalog("en").common.askTitle })).toBeDefined();
  });

  it("renders every column in the default grid; the page size only drives widths", () => {
    const { container } = renderGrid({
      activeDim: null,
      activeSelections: [],
      columns: {},
      columnList: [colCard("A"), colCard("B"), colCard("C")],
      columnCount: 3,
      placeholderLabels: [],
      running: false,
      historySeedLabel: null,
      allPageSize: 2,
    });
    expect(container.querySelectorAll(".column-card")).toHaveLength(3);
    expect(container.querySelector(".arena-columns")?.getAttribute("data-count")).toBe("2");
  });

  it("renders the paged view with the configured per-page cards and a pager", () => {
    const { container } = renderGrid({
      activeDim: null,
      activeSelections: [],
      columns: {},
      columnList: [colCard("A"), colCard("B"), colCard("C")],
      columnCount: 3,
      placeholderLabels: [],
      running: false,
      historySeedLabel: null,
      viewMode: "paged",
      pagedPageSize: 2,
    });
    expect(container.querySelectorAll(".arena-paged")).toHaveLength(1);
    expect(container.querySelectorAll(".column-card")).toHaveLength(2);
    expect(screen.getByRole("navigation", { name: getCatalog("en").arena.view.pagerAria })).toBeDefined();
    expect(screen.getByText(getCatalog("en").arena.view.pagePosition.replace("{current}", "1").replace("{total}", "2"))).toBeDefined();
  });

  it("hides the race podium until every column settles, then reveals ranked cards", () => {
    const settled = (label: string): ColumnState =>
      ({
        label,
        frameworkId: "native",
        events: [],
        metrics: { success: true, duration_ms: 100, input_tokens: 1, output_tokens: 1, total_tokens: 10, tool_calls: 1, steps: 1, context_window: 1, max_input_tokens: 1, max_output_tokens: 1, context_usage_pct: 0, input_usage_pct: 0 },
      }) as ColumnState;
    const racing = renderGrid({
      activeDim: null,
      activeSelections: [],
      columns: {},
      columnList: [colCard("A"), settled("B")],
      columnCount: 2,
      placeholderLabels: [],
      running: true,
      historySeedLabel: null,
      viewMode: "podium",
    });
    // While one column is still racing: tracks render, no ranked podium cards.
    expect(racing.container.querySelectorAll(".arena-track-lane")).toHaveLength(2);
    expect(racing.container.querySelectorAll(".arena-podium-card")).toHaveLength(0);
    racing.unmount();

    const finished = renderGrid({
      activeDim: null,
      activeSelections: [],
      columns: {},
      columnList: [settled("A"), settled("B")],
      columnCount: 2,
      placeholderLabels: [],
      running: false,
      historySeedLabel: null,
      viewMode: "podium",
    });
    expect(finished.container.querySelector(".arena-columns")).toBeNull();
    expect(finished.container.querySelectorAll(".arena-podium-card")).toHaveLength(2);
  });

  it("renders the stats view with one group per metric", () => {
    const settled = (label: string, duration: number): ColumnState =>
      ({
        label,
        frameworkId: "native",
        events: [],
        metrics: { success: true, duration_ms: duration, input_tokens: 1, output_tokens: 1, total_tokens: 10, tool_calls: 1, steps: 1, context_window: 1, max_input_tokens: 1, max_output_tokens: 1, context_usage_pct: 0, input_usage_pct: 0 },
      }) as ColumnState;
    const { container } = renderGrid({
      activeDim: null,
      activeSelections: [],
      columns: {},
      columnList: [settled("A", 100), settled("B", 200)],
      columnCount: 2,
      placeholderLabels: [],
      running: false,
      historySeedLabel: null,
      viewMode: "stats",
    });
    expect(container.querySelectorAll(".arena-stats-group")).toHaveLength(4);
    expect(container.querySelectorAll(".arena-stats-row")).toHaveLength(8);
  });

  it("renders the gallery view cards with answers", () => {
    const withAnswer = (label: string, answer: string): ColumnState =>
      ({
        label,
        frameworkId: "native",
        events: [{ type: "thought", pipeline: label, content: answer } as unknown as ColumnState["events"][number]],
      }) as unknown as ColumnState;
    const { container } = renderGrid({
      activeDim: null,
      activeSelections: [],
      columns: {},
      columnList: [withAnswer("A", "hello world")],
      columnCount: 1,
      placeholderLabels: [],
      running: false,
      historySeedLabel: null,
      viewMode: "gallery",
    });
    expect(container.querySelectorAll(".arena-gallery-card")).toHaveLength(1);
    expect(container.textContent).toContain("hello world");
  });

  it("renders the timeline view ribbons per column", () => {
    const { container } = renderGrid({
      activeDim: null,
      activeSelections: [],
      columns: {},
      columnList: [colCard("A")],
      columnCount: 1,
      placeholderLabels: [],
      running: false,
      historySeedLabel: null,
      viewMode: "timeline",
    });
    expect(container.querySelectorAll(".arena-ribbon-row")).toHaveLength(1);
  });
});
