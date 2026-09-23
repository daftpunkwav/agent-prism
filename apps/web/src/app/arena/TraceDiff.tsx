/**
 * @file TraceDiff
 * @description Cross-column trace comparison built on effective, comparable signals.
 *
 * Responsibilities:
 * - Compare final answers side by side (buildTraceComparison single source)
 * - Compare ordered tool-call sequences and mark the first divergence
 * - Compare touched workspace files across columns
 * - Expose per-column step detail and raw event logs (builder-log style)
 *
 * Deliberately NOT a per-(turn,step) alignment: step numbers from different
 * drivers/models do not form comparable rows.
 */

"use client";

import { useMemo, useState } from "react";
import { ArrowLeftRight, Braces, ChevronDown, ChevronUp, FileText, GitCommitHorizontal, ListOrdered, ScrollText, Zap } from "lucide-react";
import type { ArenaEvent } from "@agentprism/client";
import type { ColumnState } from "@agentprism/arena-view";
import { buildTraceComparison, mergeEvents, type TraceCompareColumn } from "@agentprism/arena-view";
import { MarkdownBlock } from "@/components/MarkdownBlock";
import { useT } from "@/i18n/useT";
import { CopyButton } from "./CopyButton";
import { AnswerAlignment, EntityOverlap } from "./AnswerCompare";
import { PipelineConfigCompare } from "./PipelineConfigView";

interface TraceDiffProps {
  columns: Array<ColumnState>;
  /** Locale overlay for pipeline aggregation keys. */
  resolveLabel?: (label: string) => string;
}

/** Long-text truncation threshold with an expand interaction. */
const TRUNCATE_AT = 600;

/** Expandable long text: truncated with a toggle beyond TRUNCATE_AT characters. */
function LongText({ text }: { text: string }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  if (text === "") return <span className="text-[11px] italic text-muted-foreground">{t("arena.diff.noAnswer")}</span>;
  const needsTruncate = text.length > TRUNCATE_AT;
  return (
    <div className="space-y-1">
      <div className="text-xs leading-relaxed">
        <MarkdownBlock text={needsTruncate && !expanded ? text.slice(0, TRUNCATE_AT) + "…" : text} />
      </div>
      {needsTruncate && (
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] font-mono text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? (
            <>
              <ChevronUp className="h-2.5 w-2.5" />
              {t("arena.diff.collapse")}
            </>
          ) : (
            <>
              <ChevronDown className="h-2.5 w-2.5" />
              {t("arena.diff.expand", { count: text.length })}
            </>
          )}
        </button>
      )}
    </div>
  );
}

/** One-line excerpt capped for step-detail rows. */
function excerpt(text: string, max = 220): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

/** Raw event-log JSON capped so a huge trace never blows up the DOM. */
const RAW_LOG_CHARS = 20000;

/** Step-by-step detail plus raw event log for one column (builder-log style). */
function ColumnStepDetail({ events, frameworkId }: { events: ArenaEvent[]; frameworkId?: string }) {
  const t = useT();
  const segments = useMemo(() => mergeEvents(events, frameworkId), [events, frameworkId]);
  const rows = useMemo(
    () =>
      segments.filter(
        (seg) =>
          (seg.kind === "thought" && !seg.meta && seg.text.trim() !== "") ||
          seg.kind === "action" ||
          seg.kind === "observation" ||
          seg.kind === "error" ||
          seg.kind === "thinking",
      ),
    [segments],
  );
  const rawText = useMemo(() => {
    const json = JSON.stringify(events, null, 2);
    return json.length > RAW_LOG_CHARS ? json.slice(0, RAW_LOG_CHARS) : json;
  }, [events]);
  const rawTruncated = rawText.length >= RAW_LOG_CHARS;
  if (rows.length === 0 && events.length === 0) {
    return <p className="text-[11px] italic text-muted-foreground">{t("arena.diff.noSteps")}</p>;
  }
  return (
    <div className="space-y-2">
      {rows.length > 0 && (
        <ol className="space-y-1">
          {rows.map((seg) => (
            <li key={seg.id} className="diff-step-row" data-kind={seg.kind}>
              <span className="diff-step-kind">
                {seg.kind === "thought"
                  ? t("arena.trace.answer")
                  : seg.kind === "action"
                    ? (seg.tool ?? t("arena.trace.toolCall"))
                    : seg.kind === "observation"
                      ? t("arena.trace.result")
                      : seg.kind === "error"
                        ? t("arena.trace.error")
                        : t("arena.trace.thinkingShort")}
              </span>
              <span className="diff-step-text">
                {seg.kind === "action"
                  ? excerpt(
                      [seg.tool ?? "", seg.result ? `→ ${seg.result}` : ""].filter(Boolean).join(" "),
                    )
                  : seg.kind === "thinking"
                    ? t("arena.trace.thinkingChars", { count: seg.text.length })
                    : excerpt(seg.text || seg.result || "")}
              </span>
            </li>
          ))}
        </ol>
      )}
      <details className="text-xs">
        <summary className="flex cursor-pointer items-center gap-1 text-muted-foreground">
          <Braces className="h-3 w-3" aria-hidden />
          {t("arena.diff.rawLogTitle")}
          <span className="font-mono text-muted-foreground">({t("arena.diff.eventCount", { count: events.length })})</span>
          <span className="ml-auto">
            <CopyButton text={JSON.stringify(events, null, 2)} />
          </span>
        </summary>
        <pre className="mt-1 max-h-64 overflow-auto rounded-none border border-border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-all">
          {rawText}
          {rawTruncated ? `\n${t("arena.trace.truncatedMark")}` : ""}
        </pre>
      </details>
    </div>
  );
}

/** Shared tool-call prefix rendered once, with the divergence point called out. */
function SharedPrefixSummary({ columns, prefix, diverged }: { columns: TraceCompareColumn[]; prefix: number; diverged: boolean }) {
  const t = useT();
  if (prefix === 0 || columns.length < 2) return null;
  return (
    <section className="panel-surface !shadow-none p-3 space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <GitCommitHorizontal className="h-4 w-4 text-primary" aria-hidden />
        <h4 className="text-sm font-semibold">{t("arena.diff.sharedPrefixTitle")}</h4>
        {diverged && (
          <span className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[11px] font-mono text-warning">
            {t("arena.diff.divergeAt", { count: prefix + 1 })}
          </span>
        )}
      </div>
      <ol className="space-y-0.5 pt-1">
        {columns[0]!.toolCalls.slice(0, prefix).map((call, index) => (
          <li key={index} className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            <span className="w-5 shrink-0 text-right">{t("arena.diff.sharedPrefixStep", { index: index + 1, tool: call.tool, detail: call.detail })}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** One column's comparison card: verdict, answer, tool sequence, files, steps, raw log. */
function ColumnCompareCard({
  col,
  events,
  frameworkId,
  divergeIndex,
  resolveLabel,
}: {
  col: TraceCompareColumn;
  events: ArenaEvent[];
  frameworkId?: string;
  divergeIndex: number;
  resolveLabel: (label: string) => string;
}) {
  const t = useT();
  return (
    <div className="panel-surface !shadow-none p-3 space-y-3 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-sm truncate">{resolveLabel(col.label)}</span>
        <span
          className={
            "inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11px] font-mono " +
            (col.success
              ? "bg-success/10 text-success border border-success/30"
              : "bg-destructive/10 text-destructive border border-destructive/30")
          }
        >
          {col.success ? t("arena.report.success") : t("arena.report.failed")}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {col.durationMs}ms · {col.totalTokens.toLocaleString()}
        </span>
      </div>

      <section className="space-y-1">
        <p className="flex items-center gap-1 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          <ScrollText className="h-3 w-3" aria-hidden />
          {t("arena.diff.finalAnswer")}
          {col.finalAnswer !== "" && (
            <span className="text-muted-foreground">({t("arena.diff.answerLength", { count: col.finalAnswer.length })})</span>
          )}
        </p>
        <LongText text={col.finalAnswer} />
      </section>

      <section className="space-y-1">
        <p className="flex items-center gap-1 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          <Zap className="h-3 w-3" aria-hidden />
          {t("arena.diff.toolSeqTitle")}
          <span className="text-muted-foreground">({col.toolCalls.length})</span>
        </p>
        {col.toolCalls.length === 0 ? (
          <p className="text-[11px] italic text-muted-foreground">{t("arena.diff.noToolCalls")}</p>
        ) : (
          <ol className="space-y-0.5">
            {col.toolCalls.map((call, index) => {
              const diverged = divergeIndex >= 0 && index >= divergeIndex;
              return (
                <li
                  key={`${index}-${call.tool}`}
                  className={
                    "flex items-center gap-1.5 font-mono text-[11px] " +
                    (diverged ? "text-warning" : "text-muted-foreground")
                  }
                  title={call.detail}
                >
                  <span className="w-5 shrink-0 text-right text-muted-foreground">{index + 1}.</span>
                  <span className="font-medium">{call.tool}</span>
                  {call.detail !== "" && <span className="truncate text-muted-foreground">{call.detail}</span>}
                  {diverged && <span className="shrink-0 text-[10px] uppercase opacity-80">{t("arena.diff.difference")}</span>}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="space-y-1">
        <p className="flex items-center gap-1 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          <FileText className="h-3 w-3" aria-hidden />
          {t("arena.diff.filesTitle")}
          <span className="text-muted-foreground">({col.files.length})</span>
        </p>
        {col.files.length === 0 ? (
          <p className="text-[11px] italic text-muted-foreground">{t("arena.diff.noFiles")}</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {col.files.map((path) => (
              <span
                key={path}
                className="rounded-[var(--radius-sm)] border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
              >
                {path}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-1">
        <p className="flex items-center gap-1 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          <ListOrdered className="h-3 w-3" aria-hidden />
          {t("arena.diff.stepsTitle")}
        </p>
        <ColumnStepDetail events={events} frameworkId={frameworkId} />
      </section>
    </div>
  );
}

/**
 * Cross-column trace comparison: tool sequences, shared prefix, touched files.
 *
 * @param columns Column states to compare.
 * @param resolveLabel Optional locale overlay for pipeline labels.
 */
export function TraceDiff({ columns, resolveLabel }: TraceDiffProps) {
  const t = useT();
  const show = (label: string) => (resolveLabel ? resolveLabel(label) : label);
  const comparison = useMemo(
    () =>
      buildTraceComparison(
        columns.map((c) => ({
          label: c.label,
          events: c.events,
          frameworkId: c.frameworkId,
          metrics: c.metrics
            ? { success: c.metrics.success, duration_ms: c.metrics.duration_ms, total_tokens: c.metrics.total_tokens }
            : undefined,
        })),
      ),
    [columns],
  );
  const single = comparison.columns.length === 1;
  const identical = single || (comparison.commonToolPrefix >= Math.max(...comparison.columns.map((c) => c.toolCalls.length), 0) &&
    comparison.columns.every((c) => c.toolCalls.length === comparison.columns[0]!.toolCalls.length));
  const divergeIndex = identical ? -1 : comparison.commonToolPrefix;

  if (comparison.columns.length < 1) {
    return null;
  }

  return (
    <section className="space-y-3 fade-in">
      <div className="px-1 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4 text-primary" />
          <h3 className="page-title text-sm">{t("arena.tab.diff")}</h3>
        </div>
        <span
          className={
            "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-mono border " +
            (identical
              ? "border-success/30 bg-success/10 text-success"
              : "border-warning/30 bg-warning/10 text-warning")
          }
        >
          <GitCommitHorizontal className="h-3 w-3" aria-hidden />
          {single
            ? t("arena.diff.singleColumn")
            : identical
              ? t("arena.diff.identical")
              : t("arena.diff.commonPrefix", { count: comparison.commonToolPrefix })}
        </span>
      </div>

      <PipelineConfigCompare columns={columns} resolveLabel={show} />

      {!single && (
        <>
          <AnswerAlignment columns={comparison.columns} states={comparison.columns.map((col) => columns.find((c) => c.label === col.label))} resolveLabel={show} />
          <SharedPrefixSummary columns={comparison.columns} prefix={divergeIndex >= 0 ? divergeIndex : comparison.commonToolPrefix} diverged={divergeIndex >= 0} />
          <EntityOverlap columns={comparison.columns} resolveLabel={show} />
        </>
      )}

      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 260px), 1fr))` }}>
        {comparison.columns.map((col) => {
          const source = columns.find((c) => c.label === col.label);
          return (
            <ColumnCompareCard
              key={col.label}
              col={col}
              events={source?.events ?? []}
              frameworkId={source?.frameworkId}
              divergeIndex={divergeIndex}
              resolveLabel={show}
            />
          );
        })}
      </div>

      {!single && comparison.files.length > 0 && (
        <section className="panel-surface !shadow-none p-3 space-y-2">
          <p className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            <FileText className="h-3 w-3" aria-hidden />
            {t("arena.diff.fileUnionTitle")}
            <span className="text-muted-foreground">({comparison.files.length})</span>
          </p>
          <div className="data-table-wrap">
            <table>
              <tbody>
                {comparison.files.map((file) => {
                  const shared = file.producedBy.length > 1;
                  return (
                    <tr key={file.path}>
                      <td className="font-mono text-[11px]">{file.path}</td>
                      <td className="text-right">
                        {shared ? (
                          <span className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-success/30 bg-success/10 px-1.5 py-0.5 text-[11px] font-mono text-success">
                            {t("arena.diff.sharedFile")} · {file.producedBy.map((label) => show(label)).join(" / ")}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">
                            {t("arena.diff.onlyIn", { label: show(file.producedBy[0] ?? "") })}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}
