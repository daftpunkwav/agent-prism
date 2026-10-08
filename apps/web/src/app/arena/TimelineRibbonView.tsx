/**
 * @file TimelineRibbonView
 * @description Fun rhythm view: per-column event-category ribbons, no content.
 *
 * Responsibilities:
 * - Render one lane-colored ribbon per column from merged event segments
 * - Bucket segments into coarse categories (thought/action/observation/verify/error)
 * - Show progress as proportions only; never render event text
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

/** One column's ribbon row: label, status chip, and the proportional band. */
function RibbonRow({ ribbon, display }: { ribbon: ReturnType<typeof columnRibbons>[number]; display: string }) {
  const t = useT();
  return (
    <div className="arena-ribbon-row" data-lane={0}>
      <span className="arena-stats-label truncate" title={display}>
        {display}
      </span>
      <span
        className={
          "arena-ribbon-status font-mono text-[11px] " +
          (ribbon.success === null ? "text-muted-foreground" : ribbon.success ? "text-success" : "text-destructive")
        }
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
        role="img"
        aria-label={t("arena.view.ribbonAria", { name: display })}
      >
        {ribbon.segments.map((seg, idx) => (
          <span
            key={idx}
            className={`arena-ribbon-seg ${CATEGORY_CLASS[seg.category]}`}
            style={{ width: `${seg.widthPct}%` }}
            title={`${seg.category} ×${seg.count}`}
          />
        ))}
      </div>
    </div>
  );
}

/** Event-rhythm view: compare how columns spend their steps, content-free. */
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
        {(["thought", "action", "observation", "verify", "error"] as const).map((cat) => (
          <span key={cat} className="arena-ribbon-legend-item text-[11px] text-muted-foreground">
            <span className={`arena-ribbon-seg ${CATEGORY_CLASS[cat]} arena-ribbon-legend-swatch`} />
            {t(`arena.view.ribbonCat.${cat}` as "arena.view.ribbonCat.thought")}          </span>
        ))}
      </div>
      {ribbons.map((ribbon) => (
        <RibbonRow key={ribbon.label} ribbon={ribbon} display={resolveDisplayLabel(ribbon.label)} />
      ))}
    </div>
  );
}
