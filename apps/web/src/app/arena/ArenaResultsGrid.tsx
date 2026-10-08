/**
 * @file ArenaResultsGrid
 * @description The results stage's view router and column grid.
 *
 * Responsibilities:
 * - Route to the selected alternative view (paged / podium / stats / gallery / timeline)
 * - Render the default column grid with every selected column; the per-page
 *   setting controls how wide each column may get (the rest scrolls)
 * - Render placeholders for selected lanes before events arrive
 */

"use client";

import { Zap } from "lucide-react";
import type { DimensionMeta } from "@agentprism/client";
import type { ColumnState } from "@agentprism/arena-view";
import type { PendingAskBatch } from "@/components/AskUserModal";
import { ColumnCard, ColumnPlaceholder } from "./ColumnCard";
import { PagedResultsView } from "./PagedResultsView";
import { PodiumView } from "./PodiumView";
import { StatsOverviewView } from "./StatsOverviewView";
import { AnswerGalleryView } from "./AnswerGalleryView";
import { TimelineRibbonView } from "./TimelineRibbonView";
import { useT } from "@/i18n/useT";
import { dimOptionLabel } from "./dimensionLabels";
import type { PageSize, ViewMode } from "./useViewMode";

/** Results-stage view router: alternative views plus the default column grid. */
export function ArenaResultsGrid(props: {
  activeDim: DimensionMeta | null;
  activeSelections: string[];
  columns: Record<string, ColumnState>;
  columnList: ColumnState[];
  /** Unused since the per-page cap became a width hint; kept out of the destructure. */
  columnCount?: number;
  placeholderLabels: string[];
  running: boolean;
  historySeedLabel: string | null;
  onStopColumn: (label: string) => void;
  stoppingLabels: Record<string, boolean>;
  onUseAsSeed: (label: string) => void;
  workspaceRefreshToken: number;
  /** Live ask_user batches by pipeline label: each column renders its own window. */
  pendingAsksByLabel: Record<string, PendingAskBatch>;
  askSubmitting: boolean;
  onAskAnswer: (agentId: string, questionId: string, answer: string) => Promise<boolean>;
  onAskDismiss: (agentId: string) => void;
  /** Selected results view id. */
  viewMode: ViewMode;
  /** Default view: at-most-N columns visible per screen; extra columns scroll. */
  allPageSize: PageSize;
  /** Paged view: columns rendered per page behind the pager controls. */
  pagedPageSize: PageSize;
  /** Locale-resolved display label for a pipeline label. */
  resolveDisplayLabel: (label: string) => string;
}) {
  const {
    activeDim,
    activeSelections,
    columns,
    columnList,
    placeholderLabels,
    running,
    historySeedLabel,
    onStopColumn,
    stoppingLabels,
    onUseAsSeed,
    workspaceRefreshToken,
    pendingAsksByLabel,
    askSubmitting,
    onAskAnswer,
    onAskDismiss,
    viewMode,
    allPageSize,
    pagedPageSize,
    resolveDisplayLabel,
  } = props;
  const t = useT();

  const cardProps = {
    running,
    historySeedLabel,
    onStopColumn,
    stoppingLabels,
    onUseAsSeed,
    workspaceRefreshToken,
    pendingAsksByLabel,
    askSubmitting,
    onAskAnswer,
    onAskDismiss,
  };

  // No comparison items selected: every view defers to this shared guidance
  // state; the overview views' own empty states only cover "no data yet".
  if (activeDim && !activeDim.options.some((o) => activeSelections.includes(o.value))) {
    return (
      <div className="empty-state h-full">
        <div className="empty-state-icon">
          <Zap className="h-5 w-5" />
        </div>
        <p className="text-sm">{t("arena.results.emptySelection")}</p>
        <p className="max-w-[22rem] text-xs leading-relaxed text-muted-foreground">
          {t("arena.results.emptySelectionHint")}
        </p>
      </div>
    );
  }

  if (viewMode === "podium") {
    return <PodiumView columnList={columnList} running={running} resolveDisplayLabel={resolveDisplayLabel} />;
  }
  if (viewMode === "stats") {
    return <StatsOverviewView columnList={columnList} resolveDisplayLabel={resolveDisplayLabel} />;
  }
  if (viewMode === "gallery") {
    return <AnswerGalleryView columnList={columnList} resolveDisplayLabel={resolveDisplayLabel} />;
  }
  if (viewMode === "timeline") {
    return <TimelineRibbonView columnList={columnList} resolveDisplayLabel={resolveDisplayLabel} />;
  }
  if (viewMode === "paged") {
    return (
      <PagedResultsView
        activeDim={activeDim}
        activeSelections={activeSelections}
        columns={columns}
        columnList={columnList}
        placeholderLabels={placeholderLabels}
        resolveDisplayLabel={resolveDisplayLabel}
        perPage={pagedPageSize}
        {...cardProps}
      />
    );
  }

  if (activeDim) {
    const selectedOptions = activeDim.options.filter((o) =>
      activeSelections.includes(o.value),
    );
    // Every selected column renders; the per-page setting only decides how many
    // fit on one screen (min-width per column) — the rest horizontal-scrolls.
    return (
      <div className="arena-columns" data-count={allPageSize}>
        {selectedOptions.map((opt, idx) => {
          const col = columns[opt.label];
          const displayName = dimOptionLabel(t, activeDim.id, opt.value, opt.label);
          return col ? (
            <ColumnCard
              key={opt.value}
              col={col}
              {...cardProps}
              onStop={onStopColumn}
              showStop={running && !col.metrics && col.events.length > 0}
              stopping={stoppingLabels[col.label]}
              lane={idx}
              isHistorySeed={historySeedLabel === col.label}
              displayLabel={displayName}
              pendingAsk={pendingAsksByLabel[col.label] ?? null}
            />
          ) : (
            <ColumnPlaceholder key={opt.value} name={displayName} lane={idx} />
          );
        })}
      </div>
    );
  }
  if (columnList.length === 0 && !running) {
    return (
      <div className="arena-columns" data-count={allPageSize}>
        {placeholderLabels.map((name, idx) => (
          <ColumnPlaceholder key={name} name={name} lane={idx} />
        ))}
      </div>
    );
  }

  return (
    <div className="arena-columns" data-count={allPageSize}>
      {columnList.map((col, idx) => (
        <ColumnCard
          key={col.label}
          col={col}
          {...cardProps}
          onStop={onStopColumn}
          showStop={running && !col.metrics && col.events.length > 0}
          stopping={stoppingLabels[col.label] === true}
          lane={idx}
          isHistorySeed={historySeedLabel === col.label}
          pendingAsk={pendingAsksByLabel[col.label] ?? null}
        />
      ))}
    </div>
  );
}
