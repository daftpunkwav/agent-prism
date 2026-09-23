/**
 * @file ColumnCard
 * @description Single-column run card: status, trace, and metric/judge/error bars.
 *
 * Responsibilities:
 * - Show the run status header and the trace view
 * - Render metric, judge, and error bars
 * - Show the not-yet-running placeholder skeleton
 */

"use client";

import { Square, FolderOpen, FlaskConical, Pause, Loader2, ArrowDown } from "lucide-react";
import { TokenStatsPanel } from "@agentprism/ui";
import { TraceView } from "./TraceView";
import { WorkspacePanel } from "./WorkspacePanel";
import { AskUserModal, type PendingAskBatch } from "@/components/AskUserModal";
import { useFollowScroll } from "@/hooks/useFollowScroll";
import { useT } from "@/i18n/useT";
import { memo, useState } from "react";
import type { ColumnState } from "@agentprism/arena-view";

/** Backend stopped message marker (runner.COLUMN_STOPPED_MESSAGE); matched case-insensitively. */
export function isColumnStopped(col: ColumnState): boolean {
  return typeof col.error === "string" && col.error.toLowerCase().includes("stopped by user");
}

/** Idle placeholder before a column's first run: lane-tinted invitation, not a loading state. */
export function ColumnPlaceholder({ name, lane }: { name: string; lane: number }) {
  const t = useT();
  return (
    <div className="column-card column-card-placeholder h-full" data-lane={lane % 4}>
      <div className="column-header">
        <span className="column-title truncate">{name}</span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-none border"
          style={{
            borderColor: "color-mix(in srgb, var(--lane) 45%, transparent)",
            background: "color-mix(in srgb, var(--lane) 10%, transparent)",
            color: "var(--lane)",
          }}
          aria-hidden
        >
          <FlaskConical className="h-5 w-5" />
        </div>
        <p className="text-sm font-medium text-foreground">{t("arena.results.waitingRun")}</p>
      </div>
    </div>
  );
}

/** Single-column run card: status header + trace view + metrics/judgment/error bars. Memoized: one column's delta stream must not re-render the other columns. */
export const ColumnCard = memo(function ColumnCard({
  col,
  running,
  showStop,
  onStop,
  stopping,
  lane,
  isHistorySeed,
  onUseAsSeed,
  displayLabel,
  workspaceRefreshToken,
  pendingAsk,
  askSubmitting,
  onAskAnswer,
  onAskDismiss,
}: {
  col: ColumnState;
  running: boolean;
  showStop: boolean;
  /** Stops this column; called with the column's label (kept stable across renders so the memo holds). */
  onStop: (label: string) => void;
  /** In-flight per-column stop request (spinner until the backend settles the column). */
  stopping?: boolean;
  lane: number;
  isHistorySeed?: boolean;
  /** Stable callback receiving this column's label (kept stable so the memo holds). */
  onUseAsSeed?: (label: string) => void;
  /** Locale overlay for the pipeline aggregation key (defaults to col.label). */
  displayLabel?: string;
  workspaceRefreshToken?: number;
  /** This column's live ask_user batch; renders the inline ask window when present. */
  pendingAsk?: PendingAskBatch | null;
  askSubmitting?: boolean;
  onAskAnswer?: (agentId: string, questionId: string, answer: string) => Promise<boolean>;
  onAskDismiss?: (agentId: string) => void;
}) {
  const t = useT();
  const title = displayLabel ?? col.label;
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const stopped = isColumnStopped(col);
  const columnRunning = running && !col.metrics && !stopped;
  // Per-column auto-follow: state lives in this card instance, so columns never
  // affect each other's scrolling. Every streamed delta is a new event element,
  // so the array length is a sufficient growth signal.
  const { scrollRef, detached, handleScroll, jumpToBottom } = useFollowScroll([col.events.length, columnRunning]);
  return (
    <div
      className="column-card h-full min-h-0 flex flex-col"
      data-lane={lane % 4}
      data-running={columnRunning ? "true" : undefined}
      data-stopped={stopped ? "true" : undefined}
    >
      <div className="column-header shrink-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={
                "column-status-dot " +
                (columnRunning ? "running" : col.metrics ? "done" : "") +
                " " +
                (col.error && !stopped ? "error" : "")
              }
            />
            <span className="column-title truncate">{title}</span>
            {stopped && (
              <span
                className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[11px] font-mono text-warning shrink-0"
                title={t("arena.results.stoppedTitle")}
              >
                <Pause className="h-2.5 w-2.5" aria-hidden />
                {t("arena.results.stoppedBadge")}
              </span>
            )}
            {isHistorySeed && (
              <span className="arena-seed-badge" title={t("arena.results.seedBadgeTitle")}>
                {t("arena.results.seedBadge")}
              </span>
            )}
            {col.metrics && (
              <span className="column-metric-chip font-mono text-[11px] text-muted-foreground shrink-0">
                {stopped ? t("arena.results.stoppedShort") : col.metrics.success ? "OK" : "FAIL"} · {col.metrics.duration_ms}ms
              </span>
            )}
          </div>
          {col.tokenStats && (
            <div className="mt-1.5 column-token-enter">
              <TokenStatsPanel
                stats={col.tokenStats}
                compact
                labels={{
                  compactInput: t("arena.token.compactInput"),
                  compactOutput: t("arena.token.compactOutput"),
                  compactTotal: t("arena.token.compactTotal"),
                  compactContext: t("arena.token.compactContext"),
                  input: t("arena.token.input"),
                  output: t("arena.token.output"),
                  total: t("arena.token.total"),
                  cap: t("arena.token.cap"),
                  window: t("arena.token.window"),
                  contextShare: t("arena.token.contextShare"),
                  inputShare: t("arena.token.inputShare"),
                }}
              />
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {col.workspace && (
            <button
              type="button"
              className="btn-ghost column-seed-btn !h-7 !px-2 text-[11px]"
              onClick={() => setWorkspaceOpen((v) => !v)}
              aria-expanded={workspaceOpen}
              title={t("arena.results.workspaceToggleTitle")}
            >
              <FolderOpen className="h-3 w-3" />
              {t("arena.results.workspaceToggle")}
            </button>
          )}
          {onUseAsSeed && col.metrics && !isHistorySeed && !running && (
            <button
              type="button"
              className="btn-ghost column-seed-btn !h-7 !px-2 text-[11px]"
              onClick={() => onUseAsSeed(col.label)}
              title={t("arena.results.useAsSeedTitle")}
            >
              {t("arena.results.useAsSeed")}
            </button>
          )}
          {showStop && (
            <button
              type="button"
              className="btn-ghost column-stop-btn !h-7 !px-2 text-[11px]"
              onClick={() => onStop(col.label)}
              disabled={stopping}
              title={t("arena.results.stopColumnTitle")}
              aria-label={t("arena.results.stopColumnTitle")}
            >
              {stopping ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : (
                <Square className="h-3 w-3" aria-hidden />
              )}
              {stopping ? t("arena.results.stopping") : t("arena.action.stop")}
            </button>
          )}
        </div>
      </div>
      <div className="relative flex-1 min-h-0 flex flex-col">
        {workspaceOpen && col.workspace ? (
          // Workspace takeover: the browser fills the whole column body; the
          // header keeps the toggle so the trace comes back with one click.
          <div className="flex-1 min-h-0 overflow-hidden">
            <WorkspacePanel
              workspaceName={col.workspace}
              pollInterval={running ? 1500 : 4000}
              refreshToken={workspaceRefreshToken ?? 0}
              compact
              ownerLabel={title}
            />
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto min-h-0 overscroll-contain" ref={scrollRef} onScroll={handleScroll}>
              <TraceView
                events={col.events}
                running={columnRunning}
                colorIndex={lane}
                frameworkId={col.frameworkId}
              />
            </div>
            {detached && (
              <button type="button" className="arena-jump-bottom" onClick={jumpToBottom}>
                <ArrowDown size={12} aria-hidden />
                {t("arena.results.jumpBottom")}
              </button>
            )}
          </>
        )}
      </div>
      {col.metrics && (
        <div className="column-metrics-bar border-t border-border px-3 py-2 font-mono text-[11px] text-muted-foreground flex gap-3 shrink-0">
          <span>{t("arena.results.toolCalls", { count: col.metrics.tool_calls })}</span>
          <span>{t("arena.results.steps", { count: col.metrics.steps })}</span>
        </div>
      )}
      {col.judge && (
        <div
          className={
            "column-judge-bar border-t px-3 py-2 text-[11px] shrink-0 flex items-start gap-1.5 " +
            (col.judge.passed
              ? "border-t-success/30 bg-success/5 text-success"
              : "border-t-destructive/30 bg-destructive/5 text-destructive")
          }
          title={col.judge.details.join("\n")}
        >
          <span aria-hidden className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
          <span className="min-w-0">
            <span className="font-mono font-medium">
              {col.judge.passed ? t("arena.results.judgePass") : t("arena.results.judgeFail")}
            </span>
            <span className="ml-2 text-muted-foreground">{col.judge.reason}</span>
          </span>
        </div>
      )}
      {col.error && !stopped && (
        <div className="border-t border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive shrink-0">
          {col.error}
        </div>
      )}
      {stopped && (
        <div className="border-t border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning shrink-0">
          {t("arena.results.stoppedHint")}
        </div>
      )}
      {pendingAsk !== null && pendingAsk !== undefined && onAskAnswer && onAskDismiss && (
        <AskUserModal
          variant="inline"
          pending={pendingAsk}
          submitting={askSubmitting ?? false}
          onAnswer={(questionId, answer) => onAskAnswer(pendingAsk.agentId ?? "", questionId, answer)}
          onClose={() => onAskDismiss(pendingAsk.agentId ?? "")}
        />
      )}
    </div>
  );
});
