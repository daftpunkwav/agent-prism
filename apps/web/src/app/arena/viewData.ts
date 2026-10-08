/**
 * @file viewData
 * @description Shared derivation for the alternative results views.
 *
 * Responsibilities:
 * - Extract settled per-column metrics and final answers in display order
 * - Compute normalized metric bars and podium rankings
 * - Bucket merge-pass segments into the timeline ribbon's coarse categories
 *
 * Pure functions over ColumnState; no React and no fetching.
 */

import {
  mergeEvents,
  extractFinalAnswer,
  type ColumnState,
} from "@agentprism/arena-view";

/** One column's comparable summary used by the stats and podium views. */
export interface ColumnSummary {
  label: string;
  frameworkId?: string;
  /** True when the column finished with metrics (success or failure). */
  settled: boolean;
  success: boolean;
  durationMs: number;
  totalTokens: number;
  toolCalls: number;
  steps: number;
  judgePassed: boolean | null;
  answer: string;
}

/** Builds display-ordered summaries; running columns are included with settled=false. */
export function summarizeColumns(columnList: ColumnState[]): ColumnSummary[] {
  return columnList.map((col) => {
    const metrics = col.metrics;
    return {
      label: col.label,
      frameworkId: col.frameworkId,
      settled: metrics !== undefined,
      success: metrics?.success ?? false,
      durationMs: metrics?.duration_ms ?? 0,
      totalTokens: metrics?.total_tokens ?? 0,
      toolCalls: metrics?.tool_calls ?? 0,
      steps: metrics?.steps ?? 0,
      judgePassed: col.judge ? col.judge.passed : null,
      answer: extractFinalAnswer(col.events),
    };
  });
}

/** One normalized metric row for the stats view. */
export interface MetricRow {
  key: "durationMs" | "totalTokens" | "toolCalls" | "steps";
  values: Array<{ label: string; value: number }>;
  max: number;
  bestLabel: string | null;
}

/** Lower-is-better metrics ranked in this order. */
const METRIC_KEYS: MetricRow["key"][] = ["durationMs", "totalTokens", "toolCalls", "steps"];

/** Builds one normalized row per metric over settled columns; null max keeps a bar empty. */
export function metricRows(summaries: ColumnSummary[]): MetricRow[] {
  const settled = summaries.filter((s) => s.settled);
  return METRIC_KEYS.map((key) => {
    const values = settled.map((s) => ({ label: s.label, value: s[key] }));
    const max = Math.max(...values.map((v) => v.value), 0);
    const min = Math.min(...values.map((v) => v.value));
    const bestLabel = values.find((v) => v.value === min)?.label ?? null;
    return { key, values, max, bestLabel };
  });
}

/** Coarse timeline buckets (the ribbon's segment categories). */
export type RibbonCategory = "thought" | "action" | "observation" | "verify" | "error" | "other";

/** Maps a merge-pass segment kind to its ribbon bucket. */
export function ribbonCategory(kind: string): RibbonCategory {
  switch (kind) {
    case "thought":
    case "thinking":
      return "thought";
    case "action":
      return "action";
    case "observation":
    case "tool_progress":
      return "observation";
    case "verify":
    case "reflect":
    case "harness_edit":
      return "verify";
    case "error":
      return "error";
    default:
      return "other";
  }
}

/** One column's ribbon: ordered category runs with relative widths (percent). */
export interface ColumnRibbon {
  label: string;
  running: boolean;
  success: boolean | null;
  segments: RibbonSegment[];
}

/** One collapsed run of same-category segments in a ribbon. */
export interface RibbonSegment {
  category: RibbonCategory;
  /** Merged segment count in this run. */
  count: number;
  /** Relative width in percent of the ribbon band. */
  widthPct: number;
  /** First-segment → last-segment wall-clock span (ms; 0 when events carry no timestamps). */
  spanMs: number;
  /** Opening text of the run's first segment, trimmed for tooltip sampling ("" when absent). */
  sample: string;
  /** Tool names seen across the run's action segments (deduped, first-seen order). */
  tools: string[];
}

/**
 * Builds one ribbon per column from the merged event segments: consecutive
 * segments in the same category collapse into one run. Columns without events
 * render an empty ribbon (the view shows the waiting state instead).
 */
export function columnRibbons(columnList: ColumnState[]): ColumnRibbon[] {
  return columnList.map((col) => {
    const segments = mergeEvents(col.events, col.frameworkId);
    const runs: RibbonSegment[] = [];
    // Run spans keyed by run index: start/end tracked outside the payload shape.
    const spans = new Map<number, { start: number; end: number }>();
    for (const seg of segments) {
      const category = ribbonCategory(seg.kind);
      // Normalize to a positive pair: tsEnd may exist while tsStart is absent
      // (a streamed segment created before any timestamped event arrived).
      const spanStart = seg.tsStart ?? seg.tsEnd ?? 0;
      const spanEnd = Math.max(seg.tsEnd ?? 0, spanStart);
      const tool = seg.kind === "action" ? (seg.tool ?? "") : "";
      const last = runs[runs.length - 1];
      if (last && last.category === category) {
        last.count += 1;
        if (tool && !last.tools.includes(tool)) last.tools.push(tool);
      } else {
        runs.push({
          category,
          count: 1,
          widthPct: 0,
          spanMs: 0,
          sample: (seg.text ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
          tools: tool ? [tool] : [],
        });
      }
      // Merge into the run's span; the entry is created on the first timestamped
      // segment even when the run's opening segment carried none.
      if (spanEnd > 0) {
        const span = spans.get(runs.length - 1);
        if (span) {
          span.start = Math.min(span.start, spanStart);
          span.end = Math.max(span.end, spanEnd);
        } else {
          spans.set(runs.length - 1, { start: spanStart, end: spanEnd });
        }
      }
    }
    const total = runs.reduce((sum, seg) => sum + seg.count, 0);
    for (const [idx, run] of runs.entries()) {
      run.widthPct = total > 0 ? (run.count / total) * 100 : 0;
      const span = spans.get(idx);
      if (span) run.spanMs = Math.max(span.end - span.start, run.spanMs);
    }
    const metrics = col.metrics;
    return {
      label: col.label,
      running: metrics === undefined && col.events.length > 0,
      success: metrics ? metrics.success : null,
      segments: runs,
    };
  });
}

/** One runner's live state on the race track. */
export interface RunnerState {
  label: string;
  /** Current activity headline for the runner's speech bubble ("" when idle/waiting). */
  activity: string;
  /** Coarse activity category driving the bubble icon (null when waiting). */
  activityKind: "thought" | "action" | "verify" | "done" | "error" | null;
  /** Tool name for action bubbles ("" otherwise). */
  tool: string;
  /** 0–1 progress toward the finish line; 1 means settled (finished or failed). */
  progress: number;
  /** Settled = crossed the finish line (success or failure). */
  settled: boolean;
  success: boolean | null;
  /** Elapsed seconds since the column's first event (0 when no events). */
  elapsedMs: number;
}

/**
 * Progress estimate for one column: the settled columns' step counts define the
 * race distance, so a running column's progress is its step count relative to
 * the leader's steps (capped just before the line). Settled columns map to the
 * full distance regardless of their step count, keeping finished order honest.
 */
export function runnerStates(columnList: ColumnState[], nowMs: number): RunnerState[] {
  const summaries = columnList.map((col) => {
    const segments = mergeEvents(col.events, col.frameworkId);
    const metrics = col.metrics;
    const firstTs = segments.find((seg) => seg.tsStart !== undefined)?.tsStart;
    const lastTs = segments.reduce((acc, seg) => Math.max(acc, seg.tsEnd ?? seg.tsStart ?? 0), 0);
    const last = segments[segments.length - 1];
    const settled = metrics !== undefined;
    const success = metrics ? metrics.success : null;
    // Activity: the newest segment (in flight while running, final once settled).
    const cursor = last;
    const activityKind: RunnerState["activityKind"] = settled
      ? success
        ? "done"
        : "error"
      : cursor
        ? cursor.kind === "action"
          ? "action"
          : cursor.kind === "verify" || cursor.kind === "reflect" || cursor.kind === "harness_edit"
            ? "verify"
            : "thought"
        : null;
    const tool = cursor?.kind === "action" ? (cursor.tool ?? "") : "";
    return {
      col,
      segments,
      settled,
      success,
      activityKind,
      tool,
      steps: segments.length,
      lastText: last?.text ?? "",
      startedAt: firstTs ?? 0,
      // Running columns end "now" so the elapsed clock keeps ticking between
      // events; settled columns keep their true last-timestamp end.
      endedAt: !settled || !lastTs ? nowMs : lastTs,
    };
  });

  // Race distance: the leader's step count (settled runners set the distance,
  // running runners chase it). The floors keep division safe on empty races.
  const settledSteps = summaries.filter((s) => s.settled).map((s) => s.steps);
  const distance = Math.max(1, ...settledSteps, ...summaries.map((s) => s.steps));

  return summaries.map((s) => {
    // Running runners chase distance+1 so the current leader never sits exactly
    // on the finish line (it has not crossed yet); settled runners map to 100%.
    const base = s.settled ? distance : s.steps;
    const progress = s.settled ? 1 : Math.min(base / (distance + 1), 0.99);
    // Bubble text: the current segment's opening line, trimmed for a speech bubble.
    const raw = (s.lastText || "").replace(/\s+/g, " ").trim();
    const activity = s.settled
      ? ""
      : raw.length > 80
        ? `${raw.slice(0, 77)}…`
        : raw;
    const elapsedMs = s.startedAt
      ? (s.endedAt || nowMs) - s.startedAt
      : 0;
    return {
      label: s.col.label,
      activity,
      activityKind: s.activityKind,
      tool: s.tool,
      progress,
      settled: s.settled,
      success: s.success,
      elapsedMs,
    };
  });
}
