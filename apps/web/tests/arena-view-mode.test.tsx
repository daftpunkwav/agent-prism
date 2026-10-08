// @vitest-environment jsdom
/**
 * @file arena view mode tests
 * @description Locks the view-mode hook (persistence, clamping) and the shared view data derivations.
 */

import type { ColumnState } from "@agentprism/arena-view";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PAGE_SIZE_OPTIONS, parseViewMode, useViewMode, VIEW_MODES } from "../src/app/arena/useViewMode.js";
import { columnRibbons, metricRows, ribbonCategory, runnerStates, summarizeColumns } from "../src/app/arena/viewData.js";

/** apps/web must not import @agentprism/contracts (boundary rule): derive the
 *  event type from the ColumnState shape instead of importing it directly. */
type ArenaEvent = ColumnState["events"][number];

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
    expect(result.current.prefs).toEqual({ mode: "all", allPageSize: 4, pagedPageSize: 2 });
    act(() => result.current.setMode("podium"));
    act(() => result.current.setAllPageSize(1));
    act(() => result.current.setPagedPageSize(4));
    expect(result.current.prefs).toEqual({ mode: "podium", allPageSize: 1, pagedPageSize: 4 });
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "")).toEqual({ mode: "podium", allPageSize: 1, pagedPageSize: 4 });
  });

  it("hydrates a stored preference and migrates the legacy pageSize field", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: "gallery", pageSize: 3 }));
    const { result } = renderHook(() => useViewMode());
    expect(result.current.prefs).toEqual({ mode: "gallery", allPageSize: 3, pagedPageSize: 2 });
  });

  it("falls back to defaults on corrupted storage", () => {
    window.localStorage.setItem(STORAGE_KEY, "not json");
    const { result } = renderHook(() => useViewMode());
    expect(result.current.prefs).toEqual({ mode: "all", allPageSize: 4, pagedPageSize: 2 });
  });

  it("ignores unknown stored modes and page sizes", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: "bogus", pageSize: 99 }));
    const { result } = renderHook(() => useViewMode());
    expect(result.current.prefs).toEqual({ mode: "all", allPageSize: 4, pagedPageSize: 2 });
  });

  it("keeps page-size options within the declared set", () => {
    expect([...PAGE_SIZE_OPTIONS]).toEqual([1, 2, 3, 4]);
  });

  it("keeps in-session prefs when localStorage writes fail", () => {
    const { result } = renderHook(() => useViewMode());
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    act(() => result.current.setMode("podium"));
    // Private mode / quota: the choice still applies for this session.
    expect(result.current.prefs.mode).toBe("podium");
    vi.restoreAllMocks();
    // A later successful write persists again.
    act(() => result.current.setMode("gallery"));
    expect(result.current.prefs.mode).toBe("gallery");
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "")).toMatchObject({ mode: "gallery" });
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

describe("runnerStates", () => {
  it("marks settled runners at full progress and scales running ones by their own step count", () => {
    const doneA = settled("A");
    const doneB = settled("B");
    const runningRunner = { label: "R", frameworkId: "native", events: [
      { type: "thought", pipeline: "R", content: "thinking hard about the answer" },
      { type: "action", pipeline: "R", tool: "bash" },
      { type: "observation", pipeline: "R" },
    ] } as unknown as ColumnState;
    const waiting = { label: "W", frameworkId: "native", events: [] } as unknown as ColumnState;
    const runners = runnerStates([doneA, doneB, runningRunner, waiting], 1000);
    expect(runners[0]).toMatchObject({ label: "A", settled: true, success: true, progress: 1, activityKind: "done" });
    expect(runners[2]).toMatchObject({ label: "R", settled: false, activityKind: "action" });
    const runningRunnerState = runners[2];
    expect(runningRunnerState?.progress).toBeGreaterThan(0);
    expect(runningRunnerState?.progress).toBeLessThan(1);
    expect(runningRunnerState?.tool).toBe("bash");
    // A waiting column sits at the start line with no activity.
    expect(runners[3]).toMatchObject({ label: "W", settled: false, progress: 0, activityKind: null });
  });

  it("clamps the bubble text to a short sample", () => {
    const long = "x".repeat(200);
    const col = { label: "R", frameworkId: "native", events: [{ type: "thought", pipeline: "R", content: long }] } as unknown as ColumnState;
    const [runner] = runnerStates([col], 1000);
    expect(runner?.activity.length).toBeLessThanOrEqual(80);
    expect(runner?.activity.endsWith("…")).toBe(true);
  });

  it("keeps a running column's elapsed clock ticking between events", () => {
    const col = {
      label: "R",
      frameworkId: "native",
      events: [
        { type: "thought", pipeline: "R", timestamp: 1000 },
        { type: "action", pipeline: "R", tool: "bash", timestamp: 2000 },
      ],
    } as unknown as ColumnState;
    // The last event landed at t=2000; a later tick must measure from now, not freeze at 2000.
    const [atLastEvent] = runnerStates([col], 2000);
    const [afterTick] = runnerStates([col], 7000);
    expect(atLastEvent?.elapsedMs).toBe(1000);
    expect(afterTick?.elapsedMs).toBe(6000);
    // Settled columns keep their true wall-clock span instead of following now.
    const done = settled("D", { events: col.events });
    const [settledRunner] = runnerStates([done], 7000);
    expect(settledRunner?.elapsedMs).toBe(1000);
  });

  it("never moves a runner backward when another runner gains a step", () => {
    const eventsOf = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ type: "thought", pipeline: "R", step: i + 1, content: `step ${i}` }));
    const a = { label: "A", frameworkId: "native", events: eventsOf(2) } as unknown as ColumnState;
    const [solo] = runnerStates([a], 1000);
    expect(solo?.progress).toBe(2 / 6);
    // B racing alongside with more steps must not change A's rendered progress.
    const b = { label: "B", frameworkId: "native", events: eventsOf(9) } as unknown as ColumnState;
    const [withRival] = runnerStates([a, b], 1000);
    expect(withRival?.progress).toBe(2 / 6);
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
    // Tooltip facts: action run carries its tool; widths sum to 100%.
    const actionRun = ribbon?.segments.find((s) => s.category === "action");
    expect(actionRun?.tools).toContain("bash");
  });

  it("buckets step_start segments into the other category (regression: missing ribbonCat.other)", () => {
    const events = [
      { type: "step_start", pipeline: "A", step: 1 },
      { type: "thought", pipeline: "A", step: 1 },
    ] as unknown as ArenaEvent[];
    const [ribbon] = columnRibbons([settled("A", { events })]);
    // step_start survives the merge pass as a step segment, so "other" is reachable
    // and the tooltip/legend need the ribbonCat.other key.
    expect(ribbon?.segments.map((s) => s.category)).toContain("other");
  });

  it("sums a run's wall-clock span across segments when the opener has no timestamp", () => {
    const events = [
      // Streamed thought created before any timestamp arrived, then a stamped delta.
      { type: "thought", pipeline: "A" },
      { type: "thought_delta", pipeline: "A", content: "y", timestamp: 1000 },
      { type: "thought_delta", pipeline: "A", content: "z", timestamp: 2500 },
      { type: "action", pipeline: "A", tool: "bash", timestamp: 3000 },
    ] as unknown as ArenaEvent[];
    const [ribbon] = columnRibbons([settled("A", { events })]);
    const thoughtRun = ribbon?.segments.find((s) => s.category === "thought");
    // Span = 2500 - 1000, not 0: the opener's missing tsStart must not drop the run's timestamps.
    expect(thoughtRun?.spanMs).toBe(1500);
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
