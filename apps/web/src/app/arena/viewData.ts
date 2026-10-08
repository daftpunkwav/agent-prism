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
  segments: Array<{ category: RibbonCategory; widthPct: number; count: number }>;
}

/**
 * Builds one ribbon per column from the merged event segments: consecutive
 * segments in the same category collapse into one run. Columns without events
 * render an empty ribbon (the view shows the waiting state instead).
 */
export function columnRibbons(columnList: ColumnState[]): ColumnRibbon[] {
  return columnList.map((col) => {
    const categories = mergeEvents(col.events, col.frameworkId).map((seg) => ribbonCategory(seg.kind));
    const segments: ColumnRibbon["segments"] = [];
    for (const category of categories) {
      const last = segments[segments.length - 1];
      if (last && last.category === category) {
        last.count += 1;
      } else {
        segments.push({ category, widthPct: 0, count: 1 });
      }
    }
    const total = segments.reduce((sum, seg) => sum + seg.count, 0);
    for (const seg of segments) seg.widthPct = total > 0 ? (seg.count / total) * 100 : 0;
    const metrics = col.metrics;
    return {
      label: col.label,
      running: metrics === undefined && col.events.length > 0,
      success: metrics ? metrics.success : null,
      segments,
    };
  });
}
