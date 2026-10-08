/**
 * @file PagedResultsView
 * @description Fixed-size page results view with paging controls.
 *
 * Responsibilities:
 * - Render at most N run cards per page (or placeholders before events arrive)
 * - Provide prev/next paging plus a page-position indicator
 * - Clamp the page index when the column count shrinks mid-run
 */

"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { DimensionMeta } from "@agentprism/client";
import type { ColumnState } from "@agentprism/arena-view";
import type { PendingAskBatch } from "@/components/AskUserModal";
import { ColumnCard, ColumnPlaceholder } from "./ColumnCard";
import { useT } from "@/i18n/useT";
import { dimOptionLabel } from "./dimensionLabels";

/** Paged run-card view: prev/next buttons over a fixed-size per-page card grid. */
export function PagedResultsView(props: {
  activeDim: DimensionMeta | null;
  activeSelections: string[];
  columns: Record<string, ColumnState>;
  columnList: ColumnState[];
  placeholderLabels: string[];
  running: boolean;
  historySeedLabel: string | null;
  onStopColumn: (label: string) => void;
  stoppingLabels: Record<string, boolean>;
  onUseAsSeed: (label: string) => void;
  workspaceRefreshToken: number;
  pendingAsksByLabel: Record<string, PendingAskBatch>;
  askSubmitting: boolean;
  onAskAnswer: (agentId: string, questionId: string, answer: string) => Promise<boolean>;
  onAskDismiss: (agentId: string) => void;
  /** Locale-resolved display label for a pipeline label. */
  resolveDisplayLabel: (label: string) => string;
  /** Columns rendered per page (1–4). */
  perPage: number;
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
    resolveDisplayLabel,
    perPage,
  } = props;
  const t = useT();

  // Display-ordered entries, shared by both the placeholder and the run-card paths.
  const entries: Array<{ key: string; display: string; col: ColumnState | undefined }> =
    activeDim
      ? activeDim.options
          .filter((o) => activeSelections.includes(o.value))
          .map((opt) => ({
            key: opt.value,
            display: dimOptionLabel(t, activeDim.id, opt.value, opt.label),
            col: columns[opt.label],
          }))
      : columnList.map((col) => ({
          key: col.label,
          display: resolveDisplayLabel(col.label),
          col,
        }));

  const columnsPerPage = Math.max(perPage, 1);
  const pageCount = Math.max(Math.ceil(entries.length / columnsPerPage), 1);
  const [pageRaw, setPage] = useState(0);
  // Render-time clamp: when columns shrink (dimension switch, cleared selection) the
  // stored page index would point past the last page; clamping here needs no effect.
  const page = Math.min(pageRaw, pageCount - 1);

  const pageStart = page * columnsPerPage;
  const pageEntries = entries.slice(pageStart, pageStart + columnsPerPage);

  const renderEntry = (entry: (typeof entries)[number], idx: number) =>
    entry.col ? (
      <ColumnCard
        key={entry.key}
        col={entry.col}
        running={running}
        showStop={running && !entry.col.metrics && entry.col.events.length > 0}
        onStop={onStopColumn}
        stopping={stoppingLabels[entry.col.label]}
        lane={pageStart + idx}
        isHistorySeed={historySeedLabel === entry.col.label}
        onUseAsSeed={onUseAsSeed}
        displayLabel={entry.display}
        workspaceRefreshToken={workspaceRefreshToken}
        pendingAsk={pendingAsksByLabel[entry.col.label] ?? null}
        askSubmitting={askSubmitting}
        onAskAnswer={onAskAnswer}
        onAskDismiss={onAskDismiss}
      />
    ) : (
      <ColumnPlaceholder key={entry.key} name={entry.display} lane={pageStart + idx} />
    );

  return (
    <div className="arena-paged">
      <div className="arena-columns arena-paged-grid" data-count={columnsPerPage}>
        {pageEntries.length > 0 ? (
          pageEntries.map((entry, idx) => renderEntry(entry, idx))
        ) : (
          placeholderLabels.slice(0, columnsPerPage).map((name, idx) => (
            <ColumnPlaceholder key={name} name={resolveDisplayLabel(name)} lane={idx} />
          ))
        )}
      </div>
      {pageCount > 1 && (
        <div className="arena-pager" role="navigation" aria-label={t("arena.view.pagerAria")}>
          <button
            type="button"
            className="btn-ghost arena-pager-btn"
            onClick={() => setPage((p) => Math.max(p - 1, 0))}
            disabled={page === 0}
            aria-label={t("arena.view.prevPage")}
            title={t("arena.view.prevPage")}
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          </button>
          <span className="arena-pager-position font-mono text-[11px] text-muted-foreground">
            {t("arena.view.pagePosition", { current: page + 1, total: pageCount })}
          </span>
          <button
            type="button"
            className="btn-ghost arena-pager-btn"
            onClick={() => setPage((p) => Math.min(p + 1, pageCount - 1))}
            disabled={page >= pageCount - 1}
            aria-label={t("arena.view.nextPage")}
            title={t("arena.view.nextPage")}
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
