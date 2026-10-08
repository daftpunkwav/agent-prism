/**
 * @file StatsOverviewView
 * @description Fun metrics view: normalized per-metric bars without execution detail.
 *
 * Responsibilities:
 * - Render one grouped block per metric (duration / tokens / tools / steps)
 * - Draw each column as a lane-colored bar scaled to the group max
 * - Mark the best column per metric; keep the view's detail-free promise by
 *   never rendering event text
 */

"use client";

import type { ColumnState } from "@agentprism/arena-view";
import { useT } from "@/i18n/useT";
import { metricRows, summarizeColumns, type MetricRow } from "./viewData";

/** Catalog key per metric row. */
const METRIC_LABEL_KEYS = {
  durationMs: "arena.view.metricDuration",
  totalTokens: "arena.view.metricTokens",
  toolCalls: "arena.view.metricTools",
  steps: "arena.view.metricSteps",
} as const;

/** Formats one metric value for the bar caption. */
function formatMetric(key: MetricRow["key"], value: number): string {
  if (key === "durationMs") return `${value.toLocaleString()}ms`;
  return value.toLocaleString();
}

/** One metric group: a caption row plus one bar per column. */
function MetricGroup({ row, resolveDisplayLabel }: { row: MetricRow; resolveDisplayLabel: (label: string) => string }) {
  const t = useT();
  return (
    <section className="arena-stats-group">
      <h3 className="arena-stats-group-title text-xs font-medium text-muted-foreground">
        {t(METRIC_LABEL_KEYS[row.key])}
      </h3>
      <div className="arena-stats-bars">
        {row.values.map((v) => {
          const isBest = row.bestLabel === v.label && row.values.length > 1;
          return (
            <div key={v.label} className="arena-stats-row" data-best={isBest ? "true" : undefined}>
              <span className="arena-stats-label truncate" title={resolveDisplayLabel(v.label)}>
                {resolveDisplayLabel(v.label)}
              </span>
              <div
                className="arena-stats-bar"
                style={{ width: row.max > 0 ? `${Math.max((v.value / row.max) * 100, 2)}%` : "0%" }}
                role="meter"
                aria-valuemin={0}
                aria-valuemax={row.max}
                aria-valuenow={v.value}
                aria-label={resolveDisplayLabel(v.label)}
              />
              <span className="arena-stats-value font-mono text-[11px] text-muted-foreground">
                {formatMetric(row.key, v.value)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Metrics-at-a-glance view: no trace detail, only comparable bars. */
export function StatsOverviewView({ columnList, resolveDisplayLabel }: {
  columnList: ColumnState[];
  /** Locale-resolved display label for a pipeline label. */
  resolveDisplayLabel: (label: string) => string;
}) {
  const t = useT();
  const rows = metricRows(summarizeColumns(columnList));

  if (rows.every((row) => row.values.length === 0)) {
    return (
      <div className="empty-state h-full">
        <p className="text-sm">{t("arena.view.statsEmpty")}</p>
        <p className="max-w-[22rem] text-xs leading-relaxed text-muted-foreground">
          {t("arena.view.statsEmptyHint")}
        </p>
      </div>
    );
  }

  return (
    <div className="arena-stage-scroll arena-stats">
      {rows.map((row) => (
        <MetricGroup key={row.key} row={row} resolveDisplayLabel={resolveDisplayLabel} />
      ))}
    </div>
  );
}
