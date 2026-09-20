/**
 * @file ArenaResultsGrid
 * @description The results stage's column grid.
 *
 * Responsibilities:
 * - Render placeholders for selected lanes before events arrive
 * - Render run cards once events arrive
 */

"use client";

import { Zap } from "lucide-react";
import type { DimensionMeta } from "@agentprism/client";
import type { ColumnState } from "@agentprism/arena-view";
import type { PendingAskBatch } from "@/components/AskUserModal";
import { ColumnCard, ColumnPlaceholder } from "./ColumnCard";
import { useT } from "@/i18n/useT";
import { dimOptionLabel } from "./dimensionLabels";

/** Results-stage column grid: placeholders before events, run cards after. */
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
  } = props;
  const t = useT();

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
    return (
      <div className="arena-columns" data-count={Math.min(Math.max(selectedOptions.length, 1), 4)}>
        {selectedOptions.map((opt, idx) => {
          const col = columns[opt.label];
          const displayName = dimOptionLabel(t, activeDim.id, opt.value, opt.label);
          return col ? (
            <ColumnCard
              key={opt.value}
              col={col}
              running={running}
              showStop={running && !col.metrics && col.events.length > 0}
              onStop={() => onStopColumn(col.label)}
              stopping={stoppingLabels[col.label] === true}
              lane={idx}
              isHistorySeed={historySeedLabel === col.label}
              onUseAsSeed={onUseAsSeed}
              displayLabel={displayName}
              workspaceRefreshToken={workspaceRefreshToken}
              pendingAsk={pendingAsksByLabel[col.label] ?? null}
              askSubmitting={askSubmitting}
              onAskAnswer={onAskAnswer}
              onAskDismiss={onAskDismiss}
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
      <div className="arena-columns" data-count={Math.min(columnCount, 4)}>
        {placeholderLabels.slice(0, columnCount).map((name, idx) => (
          <ColumnPlaceholder key={name} name={name} lane={idx} />
        ))}
      </div>
    );
  }

  return (
    <div className="arena-columns" data-count={Math.min(Math.max(columnList.length, 1), 4)}>
      {columnList.map((col, idx) => (
        <ColumnCard
          key={col.label}
          col={col}
          running={running}
          showStop={running && !col.metrics && col.events.length > 0}
          onStop={() => onStopColumn(col.label)}
          stopping={stoppingLabels[col.label] === true}
          lane={idx}
          isHistorySeed={historySeedLabel === col.label}
          onUseAsSeed={onUseAsSeed}
          workspaceRefreshToken={workspaceRefreshToken}
          pendingAsk={pendingAsksByLabel[col.label] ?? null}
          askSubmitting={askSubmitting}
          onAskAnswer={onAskAnswer}
          onAskDismiss={onAskDismiss}
        />
      ))}
    </div>
  );
}
