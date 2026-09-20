// @vitest-environment jsdom
/**
 * @file matrix-panel tests
 * @description Locks the matrix panel: run-all, progress, and scoreboard.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { MatrixPanel } from "../src/app/arena/MatrixPanel.js";

vi.mock("@agentprism/client", () => ({
  fetchTemplates: vi.fn(async () => [
    { id: "t1", question: "q1", suggested_dimension: "framework", suggested_selections: ["native"], category: "scored" },
  ]),
  streamMatrixRun: vi.fn(async ({ onItem }: { onItem: (item: unknown) => void }) => {
    onItem({ type: "matrix_progress", template_id: "t1", status: "scored", score: "1/1", error: "" });
    onItem({
      type: "matrix_report",
      report: {
        cells: [
          {
            template_id: "t1",
            dimension: "framework",
            selections: ["native"],
            score: { passed: 1, total: 1 },
            columns: { native: true },
            metrics: { total_tokens: 120, tool_calls: 3, steps: 2 },
          },
        ],
      },
    });
  }),
  isAbortError: vi.fn(() => false),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPanel() {
  return render(
    <I18nProvider initialLocale="en">
      <MatrixPanel setError={() => {}} />
    </I18nProvider>,
  );
}

describe("matrix panel", () => {
  it("runs the full matrix and renders progress plus scoreboard", async () => {
    renderPanel();
    fireEvent.click(screen.getByText("Run full matrix"));
    await waitFor(() => expect(screen.getAllByText("t1").length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText("Tokens")).toBeDefined();
    expect(screen.getByText("120")).toBeDefined();
    expect(screen.getByText("native=pass")).toBeDefined();
  });
});
