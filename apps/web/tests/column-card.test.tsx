// @vitest-environment jsdom
/**
 * @file column card tests
 * @description Locks the run card: status header, stop/seed buttons, and metric/judge/error/stopped bars.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ColumnState } from "@agentprism/arena-view";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { ColumnCard, ColumnPlaceholder, isColumnStopped } from "../src/app/arena/ColumnCard.js";

vi.mock("../src/app/arena/WorkspacePanel.js", () => ({
  WorkspacePanel: () => <div>workspace-panel-stub</div>,
}));

afterEach(cleanup);

function col(overrides?: Partial<ColumnState>): ColumnState {
  return { label: "Native", frameworkId: "native", events: [], ...overrides } as ColumnState;
}

function renderCard(props: {
  col: ColumnState;
  running?: boolean;
  showStop?: boolean;
  stopping?: boolean;
  isHistorySeed?: boolean;
  onUseAsSeed?: (label: string) => void;
}) {
  return render(
    <I18nProvider initialLocale="en">
      <ColumnCard
        col={props.col}
        running={props.running ?? false}
        showStop={props.showStop ?? false}
        onStop={vi.fn()}
        stopping={props.stopping}
        lane={1}
        isHistorySeed={props.isHistorySeed}
        onUseAsSeed={props.onUseAsSeed}
      />
    </I18nProvider>,
  );
}

const en = () => getCatalog("en").arena.results;

describe("ColumnPlaceholder", () => {
  it("shows the lane invitation", () => {
    render(
      <I18nProvider initialLocale="en">
        <ColumnPlaceholder name="LangChain" lane={2} />
      </I18nProvider>,
    );
    expect(screen.getByText("LangChain")).toBeDefined();
    expect(screen.getByText(en().waitingRun)).toBeDefined();
  });
});

describe("isColumnStopped", () => {
  it("matches the backend stopped marker case-insensitively", () => {
    expect(isColumnStopped(col({ error: "Stopped by user request" }))).toBe(true);
    expect(isColumnStopped(col({ error: "route down" }))).toBe(false);
    expect(isColumnStopped(col())).toBe(false);
  });
});

describe("ColumnCard", () => {
  it("renders the title and the running state attribute", () => {
    const { container } = renderCard({ col: col(), running: true });
    expect(screen.getByText("Native")).toBeDefined();
    expect(container.querySelector(".column-card")?.getAttribute("data-running")).toBe("true");
  });

  it("shows the error bar for real failures and the stopped badge for user stops", () => {
    const failed = renderCard({ col: col({ error: "disk on fire" }) });
    expect(screen.getByText("disk on fire")).toBeDefined();
    failed.unmount();

    const stopped = renderCard({ col: col({ error: "stopped by user request" }) });
    expect(screen.getByText(en().stoppedBadge)).toBeDefined();
    expect(screen.getByText(en().stoppedHint)).toBeDefined();
    expect(stopped.container.querySelector(".column-card")?.getAttribute("data-stopped")).toBe("true");
  });

  it("renders the OK/FAIL metric chip and the tool/steps bar on completion", () => {
    renderCard({
      col: col({
        metrics: { success: true, duration_ms: 123, tool_calls: 2, steps: 4 },
        tokenStats: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
      } as unknown as ColumnState),
    });
    expect(screen.getByText(/OK · 123ms/)).toBeDefined();
    expect(screen.getByText(new RegExp(en().toolCalls.replace("{count}", "2")))).toBeDefined();
    expect(screen.getByText(new RegExp(en().steps.replace("{count}", "4")))).toBeDefined();
  });

  it("renders the judge bar colored by outcome", () => {
    renderCard({ col: col({ judge: { passed: true, reason: "matched", details: ["d"] } } as unknown as ColumnState) });
    expect(screen.getByText(en().judgePass)).toBeDefined();
    expect(screen.getByText("matched")).toBeDefined();
  });

  it("offers use-as-seed on a settled column and hands back the label", () => {
    const onUseAsSeed = vi.fn();
    const settled = renderCard({
      col: col({ metrics: { success: true, duration_ms: 5, tool_calls: 0, steps: 1 } } as unknown as ColumnState),
      onUseAsSeed,
    });
    fireEvent.click(screen.getByRole("button", { name: en().useAsSeed }));
    expect(onUseAsSeed).toHaveBeenCalledWith("Native");
    settled.unmount();
    renderCard({ col: col(), onUseAsSeed });
    expect(screen.queryByRole("button", { name: en().useAsSeed })).toBeNull();
  });

  it("shows the stop button only when asked and honors the stopping spinner", () => {
    const onStop = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <ColumnCard
          col={col()}
          running
          showStop
          onStop={onStop}
          stopping
          lane={0}
        />
      </I18nProvider>,
    );
    const stop = screen.getByRole("button", { name: en().stopColumnTitle }) as HTMLButtonElement;
    expect(stop.disabled).toBe(true);
    expect(screen.getByText(en().stopping)).toBeDefined();
    fireEvent.click(stop);
    expect(onStop).not.toHaveBeenCalled();
  });

  it("toggles the workspace panel for columns that have a workspace", () => {
    renderCard({ col: col({ workspace: "ws-native" }) });
    const toggle = screen.getByRole("button", { name: en().workspaceToggle });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByText("workspace-panel-stub")).toBeDefined();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });
});
