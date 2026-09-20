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
    expect(container.querySelector(".arena-columns")?.getAttribute("data-count")).toBe("2");
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
});
