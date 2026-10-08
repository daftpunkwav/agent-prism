// @vitest-environment jsdom
/**
 * @file arena view mode tests
 * @description Locks the view-mode hook (persistence, clamping) and the shared view data derivations.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ArenaEvent } from "@agentprism/contracts";
import type { ColumnState } from "@agentprism/arena-view";
import { parseViewMode, PAGE_SIZE_OPTIONS, useViewMode, VIEW_MODES } from "../src/app/arena/useViewMode.js";
import { columnRibbons, metricRows, ribbonCategory, summarizeColumns } from "../src/app/arena/viewData.js";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const STORAGE_KEY = "agentprism.arena.viewMode.v1";

describe("parseViewMode", () => {
  it("accepts known mode ids and rejects unknown ones", () => {
    for (const mode of VIEW_MODES) expect(parseViewMode(mode)).toBe(mode);
    expect(parseViewMode("nope")).toBeUndefined();
    expect(parseViewMode("")).toBeUndefined();
  });
});

describe("useViewMode", () => {
  it("starts with defaults and persists changes", () => {
    const { result } = renderHook(() => useViewMode());
    expect(result.current.prefs).toEqual({ mode: "all", pageSize: 4 });
    act(() => result.current.setMode("podium"));
    act(() => result.current.setPageSize(6));
    expect(result.current.prefs).toEqual({ mode: "podium", pageSize: 6 });
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "")).toEqual({ mode: "podium", pageSize: 6 });
  });

  it("hydrates a stored preference after mount", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: "gallery", pageSize: 5 }));
    const { result } = renderHook(() => useViewMode());
    act(() => {
      // flush the hydration effect
    });
    expect(result.current.prefs).toEqual({ mode: "gallery", pageSize: 5 });
  });

  it("falls back to defaults on corrupted storage", () => {
    window.localStorage.setItem(STORAGE_KEY, "not json");
    const { result } = renderHook(() => useViewMode());
    expect(result.current.prefs).toEqual({ mode: "all", pageSize: 4 });
  });

  it("ignores unknown stored modes and page sizes", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: "bogus", pageSize: 99 }));
    const { result } = renderHook(() => useViewMode());
    expect(result.current.prefs).toEqual({ mode: "all", pageSize: 4 });
  });

  it("keeps page-size options within the declared set", () => {
    expect([...PAGE_SIZE_OPTIONS]).toEqual([3, 4, 5, 6]);
  });
});

const settled = (label: string, over: Partial<ColumnState> = {}): ColumnState =>
  ({
    label,
    frameworkId: "native",
    events: [],
    metrics: { success: true, duration_ms: 100, input_tokens: 1, output_tokens: 1, total_tokens: 10, tool_calls: 2, steps: 3, context_window: 128000, max_input_tokens: 120000, max_output_tokens: 96000, context_usage_pct: 0, input_usage_pct: 0 },
    ...over,
  }) as ColumnState;

describe("summarizeColumns", () => {
  it("extracts settled summaries and final answers", () => {
    const running: ColumnState = { label: "R", frameworkId: "native", events: [] } as ColumnState;
    const done = settled("D", {
      events: [
        { type: "thought", pipeline: "D", content: "final answer text" } as ArenaEvent,
      ],
    });
    const summaries = summarizeColumns([running, done]);
    expect(summaries[0]).toMatchObject({ label: "R", settled: false, success: false });
    expect(summaries[1]).toMatchObject({ label: "D", settled: true, durationMs: 100, totalTokens: 10 });
  });
});

describe("metricRows", () => {
  it("normalizes rows over settled columns and marks the best", () => {
    const rows = metricRows(summarizeColumns([settled("a"), settled("b")]));
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.values).toHaveLength(2);
      expect(row.max).toBeGreaterThanOrEqual(0);
      expect(row.bestLabel).toBeTruthy();
    }
  });

  it("returns empty rows when nothing settled", () => {
    const rows = metricRows(summarizeColumns([{ label: "R", frameworkId: "native", events: [] } as ColumnState]));
    expect(rows.every((row) => row.values.length === 0)).toBe(true);
  });
});

describe("columnRibbons", () => {
  it("collapses consecutive same-category segments and normalizes widths", () => {
    const events = [
      { type: "thought", pipeline: "A" },
      { type: "thought_delta", pipeline: "A", content: "x" },
      { type: "action", pipeline: "A", tool: "bash" },
      { type: "observation", pipeline: "A" },
      { type: "reflect", pipeline: "A" },
    ] as unknown as ArenaEvent[];
    const [ribbon] = columnRibbons([settled("A", { events })]);
    // Observation folds into its action segment (mergeEvents contract); reflect lands in verify.
    expect(ribbon?.segments.map((s) => s.category)).toEqual(["thought", "action", "verify"]);
    const total = (ribbon?.segments ?? []).reduce((sum, s) => sum + s.widthPct, 0);
    expect(total).toBeCloseTo(100, 5);
  });

  it("maps kinds to buckets and marks running columns", () => {
    expect(ribbonCategory("thinking")).toBe("thought");
    expect(ribbonCategory("tool_progress")).toBe("observation");
    expect(ribbonCategory("verify")).toBe("verify");
    expect(ribbonCategory("error")).toBe("error");
    expect(ribbonCategory("report")).toBe("other");
    const running = columnRibbons([{ label: "R", frameworkId: "native", events: [{ type: "thought", pipeline: "R" } as ArenaEvent] } as ColumnState])[0];
    expect(running?.running).toBe(true);
    expect(running?.success).toBeNull();
  });
});
