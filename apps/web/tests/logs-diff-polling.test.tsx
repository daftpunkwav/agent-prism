// @vitest-environment jsdom
/**
 * @file logs diff polling tests
 * @description Locks the logs-tab polling lifecycle: live while a column has no
 * metrics yet, stopped once settled, and resilient to failed refreshes.
 *
 * Responsibilities:
 * - Pin the running/metrics polling gate with 2s repeats
 * - Pin that a settled column fetches exactly once
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { LogsDiff } from "../src/app/arena/LogsDiff.js";
import type { ColumnState } from "@agentprism/arena-view";

vi.mock("@agentprism/client", () => ({
  fetchColumnLogs: vi.fn(async () => ({
    workspace: "ws1",
    label: "Native Agent",
    events: [],
    wire: [],
    truncated: false,
  })),
}));

const { fetchColumnLogs } = await import("@agentprism/client");
const fetchMock = vi.mocked(fetchColumnLogs);

function makeMetrics() {
  return {
    success: true,
    duration_ms: 10,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    tool_calls: 1,
    steps: 1,
    context_window: 128_000,
    max_input_tokens: 120_000,
    max_output_tokens: 4096,
    context_usage_pct: 0,
    input_usage_pct: 0,
  };
}

const liveColumn: ColumnState = { label: "Native Agent", events: [], workspace: "ws1" };
const settledColumn: ColumnState = { ...liveColumn, metrics: makeMetrics() };

function renderLogs(columns: ColumnState[], running: boolean): void {
  render(
    <I18nProvider initialLocale="en">
      <LogsDiff columns={columns} running={running} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  fetchMock.mockClear();
});

describe("LogsDiff polling", () => {
  it("re-polls a running column every 2s while it has no metrics", async () => {
    renderLogs([liveColumn], true);
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("ws1", "Native Agent");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops polling once the column has settled metrics", async () => {
    renderLogs([settledColumn], true);
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not poll at all when nothing is running", async () => {
    renderLogs([liveColumn], false);
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps rendering through a failed refresh and retries on the next tick", async () => {
    renderLogs([liveColumn], true);
    await act(async () => {});
    expect(screen.getByText("LLM wire")).toBeDefined();
    fetchMock.mockRejectedValueOnce(new Error("boom"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    // The failed tick still schedules the next one.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("LLM wire")).toBeDefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
