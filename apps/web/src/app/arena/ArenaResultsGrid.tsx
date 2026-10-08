/**
 * @file ArenaResultsGrid
 * @description The results stage's view router and column grid.
 *
 * Responsibilities:
 * - Route to the selected alternative view (paged / podium / stats / gallery / timeline)
 * - Render the default column grid capped at the configured page size
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
import type { ViewMode } from "./useViewMode";

/** Results-stage view router: alternative views plus the default column grid. */
export function ArenaResultsGrid(props: {
  activeDim: DimensionMeta | null;
  activeSelections: string[];
  columns: Record<string, ColumnState>;
  columnList: ColumnState[];
  columnCount: number;
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
  /** Default view only: cap on simultaneously rendered columns. */
  pageSize: number;
  /** Locale-resolved display label for a pipeline label. */
  resolveDisplayLabel: (label: string) => string;
}) {
  const {
    activeDim,
    activeSelections,
    columns,
    columnList,
    columnCount,
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
    pageSize,
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

  if (viewMode === "podium") {
    return <PodiumView columnList={columnList} resolveDisplayLabel={resolveDisplayLabel} />;
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
        {...cardProps}
      />
    );
  }

  if (activeDim) {
    const selectedOptions = activeDim.options.filter((o) =>
      activeSelections.includes(o.value),
    );
    if (selectedOptions.length === 0) {
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
    // The page-size cap truncates the rendered columns; the rest stays reachable
    // through the grid's horizontal scroll (same as before, wider runs wrap).
    const visible = selectedOptions.slice(0, Math.max(pageSize, 1));
    return (
      <div className="arena-columns" data-count={Math.min(Math.max(visible.length, 1), pageSize)}>
        {visible.map((opt, idx) => {
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
    const visibleCount = Math.min(columnCount, pageSize);
    return (
      <div className="arena-columns" data-count={visibleCount}>
        {placeholderLabels.slice(0, visibleCount).map((name, idx) => (
          <ColumnPlaceholder key={name} name={name} lane={idx} />
        ))}
      </div>
    );
  }

  const visible = columnList.slice(0, Math.max(pageSize, 1));
  return (
    <div className="arena-columns" data-count={Math.min(Math.max(visible.length, 1), pageSize)}>
      {visible.map((col, idx) => (
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
