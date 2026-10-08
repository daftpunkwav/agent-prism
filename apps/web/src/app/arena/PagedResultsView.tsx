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

import type { ColumnState } from "@agentprism/arena-view";
import type { DimensionMeta } from "@agentprism/client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { PendingAskBatch } from "@/components/AskUserModal";
import { useT } from "@/i18n/useT";
import { ColumnCard, ColumnPlaceholder } from "./ColumnCard";
import { dimOptionLabel } from "./dimensionLabels";

/** One paged entry: display label plus the live column state (undefined before events). */
interface PageEntry {
  key: string;
  display: string;
  col: ColumnState | undefined;
}

type TFn = ReturnType<typeof useT>;

/** Display-ordered entries, shared by the placeholder and run-card paths. */
function buildPageEntries(input: {
  activeDim: DimensionMeta | null;
  activeSelections: string[];
  columns: Record<string, ColumnState>;
  columnList: ColumnState[];
  t: TFn;
  resolveDisplayLabel: (label: string) => string;
}): PageEntry[] {
  const { activeDim, activeSelections, columns, columnList, t, resolveDisplayLabel } = input;
  if (activeDim) {
    return activeDim.options
      .filter((o) => activeSelections.includes(o.value))
      .map((opt) => ({
        key: opt.value,
        display: dimOptionLabel(t, activeDim.id, opt.value, opt.label),
        col: columns[opt.label],
      }));
  }
  return columnList.map((col) => ({
    key: col.label,
    display: resolveDisplayLabel(col.label),
    col,
  }));
}

/** Prev/next pager strip with a page-position caption. */
function ArenaPager({ page, pageCount, onPageChange, pagerAria, prevAria, nextAria, position }: {
  page: number;
  pageCount: number;
  onPageChange: (next: number) => void;
  pagerAria: string;
  prevAria: string;
  nextAria: string;
  position: string;
}) {
  return (
    <nav className="arena-pager" aria-label={pagerAria}>
      <button
        type="button"
        className="btn-ghost arena-pager-btn"
        onClick={() => onPageChange(Math.max(page - 1, 0))}
        disabled={page === 0}
        aria-label={prevAria}
        title={prevAria}
      >
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
      </button>
      <span className="arena-pager-position font-mono text-[11px] text-muted-foreground">{position}</span>
      <button
        type="button"
        className="btn-ghost arena-pager-btn"
        onClick={() => onPageChange(Math.min(page + 1, pageCount - 1))}
        disabled={page >= pageCount - 1}
        aria-label={nextAria}
        title={nextAria}
      >
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
      </button>
    </nav>
  );
}

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

  const entries = buildPageEntries({ activeDim, activeSelections, columns, columnList, t, resolveDisplayLabel });

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
        <ArenaPager
          page={page}
          pageCount={pageCount}
          onPageChange={setPage}
          pagerAria={t("arena.view.pagerAria")}
          prevAria={t("arena.view.prevPage")}
          nextAria={t("arena.view.nextPage")}
          position={t("arena.view.pagePosition", { current: page + 1, total: pageCount })}
        />
      )}
    </div>
  );
}
