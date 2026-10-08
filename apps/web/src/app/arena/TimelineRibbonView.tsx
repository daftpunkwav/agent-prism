/**
 * @file TimelineRibbonView
 * @description Fun rhythm view: per-column event-category ribbons, no content.
 *
 * Responsibilities:
 * - Render one lane-colored ribbon per column from merged event segments
 * - Bucket segments into coarse categories (thought/action/observation/verify/error/other)
 * - Hover or focus a segment for its details: category, event count, share,
 *   time span, tools used, and a text sample
 *
 * Accessibility: each segment is a real button — natively keyboard-reachable
 * (CodeRabbit) and an interactive element, so the describedby tooltip hookup
 * never needs a tabIndex on non-interactive content (S6845). The band is a
 * labeled group; buttons never nest interactive content.
 */

"use client";

import type { ColumnState } from "@agentprism/arena-view";
import { useT } from "@/i18n/useT";
import { columnRibbons, type RibbonCategory } from "./viewData";

/** Stable ribbon hue per category (lane-independent so patterns stay comparable). */
const CATEGORY_CLASS: Record<RibbonCategory, string> = {
  thought: "arena-ribbon-seg-thought",
  action: "arena-ribbon-seg-action",
  observation: "arena-ribbon-seg-observation",
  verify: "arena-ribbon-seg-verify",
  error: "arena-ribbon-seg-error",
  other: "arena-ribbon-seg-other",
};

/** Formats a millisecond span for the tooltip ("1.2s", "850ms"). */
function formatSpan(ms: number): string {
  if (ms <= 0) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/** One segment's hover tooltip: coarse category facts plus a text sample. */
function SegmentTooltip({ seg, colLabel, descId }: { seg: ReturnType<typeof columnRibbons>[number]["segments"][number]; colLabel: string; descId: string }) {
  const t = useT();
  const span = formatSpan(seg.spanMs);
  return (
    <span className="arena-ribbon-tooltip" role="tooltip" id={descId}>
      <span className="arena-ribbon-tooltip-title font-mono">
        {t(`arena.view.ribbonCat.${seg.category}` as "arena.view.ribbonCat.thought")}
        {` · ×${seg.count} · ${Math.round(seg.widthPct)}%`}
        {span ? ` · ${span}` : ""}
      </span>
      {seg.tools.length > 0 && (
        <span className="arena-ribbon-tooltip-tools font-mono">{seg.tools.join(", ")}</span>
      )}
      {seg.sample && (
        <span className="arena-ribbon-tooltip-sample">{seg.sample}</span>
      )}
      <span className="arena-ribbon-tooltip-col text-muted-foreground">{colLabel}</span>
    </span>
  );
}

/** One column's ribbon row: label, status chip, and the proportional band. */
function RibbonRow({ ribbon, display }: { ribbon: ReturnType<typeof columnRibbons>[number]; display: string }) {
  const t = useT();
  return (
    <div className="arena-ribbon-row" data-lane={0}>
      <span className="arena-stats-label truncate" title={display}>
        {display}
      </span>
      <span
        className={`arena-ribbon-status font-mono text-[11px] ${
          ribbon.success === null ? "text-muted-foreground" : ribbon.success ? "text-success" : "text-destructive"
        }`}
      >
        {ribbon.success === null
          ? ribbon.running
            ? t("arena.view.galleryRunning")
            : t("arena.view.ribbonWaiting")
          : ribbon.success
            ? t("arena.view.galleryOk")
            : t("arena.view.galleryFail")}
      </span>
      <div
        className="arena-ribbon-band"
        role="group"
        aria-label={t("arena.view.ribbonAria", { name: display })}
      >
        {ribbon.segments.map((seg, idx) => (
          // A real button: the only shape that satisfies both keyboard reach
          // (CodeRabbit) and "tabIndex only on interactive elements" (S6845)
          // while keeping the describedby tooltip hookup.
          <button
            key={idx}
            type="button"
            className={`arena-ribbon-seg ${CATEGORY_CLASS[seg.category]}`}
            style={{ width: `${seg.widthPct}%` }}
            aria-describedby={`ribbon-seg-${idx}-${ribbon.label}`}
          >
            <SegmentTooltip seg={seg} colLabel={display} descId={`ribbon-seg-${idx}-${ribbon.label}`} />
            <span className="sr-only">
              {t(`arena.view.ribbonCat.${seg.category}` as "arena.view.ribbonCat.thought")}
              {` ×${seg.count}`}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Event-rhythm view: compare how columns spend their steps, content-free until hover. */
export function TimelineRibbonView({ columnList, resolveDisplayLabel }: {
  columnList: ColumnState[];
  /** Locale-resolved display label for a pipeline label. */
  resolveDisplayLabel: (label: string) => string;
}) {
  const t = useT();
  const ribbons = columnRibbons(columnList);

  if (ribbons.length === 0) {
    return (
      <div className="empty-state h-full">
        <p className="text-sm">{t("arena.view.ribbonEmpty")}</p>
        <p className="max-w-[22rem] text-xs leading-relaxed text-muted-foreground">
          {t("arena.view.ribbonEmptyHint")}
        </p>
      </div>
    );
  }

  return (
    <div className="arena-stage-scroll arena-ribbons">
      <div className="arena-ribbon-legend" aria-hidden>
        {(["thought", "action", "observation", "verify", "error", "other"] as const).map((cat) => (
          <span key={cat} className="arena-ribbon-legend-item text-[11px] text-muted-foreground">
            <span className={`arena-ribbon-seg ${CATEGORY_CLASS[cat]} arena-ribbon-legend-swatch`} />
            {t(`arena.view.ribbonCat.${cat}` as "arena.view.ribbonCat.thought")}
          </span>
        ))}
      </div>
      {ribbons.map((ribbon) => (
        <RibbonRow key={ribbon.label} ribbon={ribbon} display={resolveDisplayLabel(ribbon.label)} />
      ))}
    </div>
  );
}
