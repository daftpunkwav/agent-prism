/**
 * @file ComparisonReport
 * @description Comparison-report renderer: verdict strip, config compare, metrics, answers, tools, ablation, artifacts, narrative, raw log.
 *
 * Responsibilities:
 * - Lead with a gap verdict so the columns' differences read at a glance
 * - Render hard metrics, answers, tool sequences, ablation, artifacts, narrative
 * - Split the backend narrative from its [Ablation] grounding suffix and clean
 *   legacy JSON-block dumps so the story reads as prose, not raw payloads
 */

"use client";

import { useMemo } from "react";
import { BarChart3, FileText, MessageSquareText, Activity, Zap, Braces, CircleCheck, CircleX } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  buildTraceComparison,
  extractFinalAnswer,
  type ColumnState,
} from "@agentprism/arena-view";
import type { ComparisonReportPayload } from "@agentprism/client";
import { useT } from "@/i18n/useT";
import { CopyButton } from "./CopyButton";
import { AnswerAlignment, EntityOverlap } from "./AnswerCompare";
import { PipelineConfigCompare } from "./PipelineConfigView";
import { cleanNarrativeBody, splitNarrative } from "./narrative";

/**
 * Renders the comparison report narrative plus per-column hard metrics.
 *
 * @param columns Column states keyed by label (final answers derive here).
 * @param report Report payload or null while the judge is pending.
 * @param resolveLabel Optional locale overlay for pipeline labels.
 */
export function ComparisonReport({
  columns,
  report,
  resolveLabel,
}: {
  columns: Record<string, ColumnState>;
  report?: ComparisonReportPayload | null;
  /** Locale overlay for pipeline aggregation keys. */
  resolveLabel?: (label: string) => string;
}) {
  const t = useT();
  const show = (label: string) => (resolveLabel ? resolveLabel(label) : label);
  const cols = Object.values(columns).filter((c) => c.metrics);
  const columnList = useMemo(() => Object.values(columns), [columns]);
  const comparison = useMemo(
    () =>
      buildTraceComparison(
        columnList.map((c) => ({
          label: c.label,
          events: c.events,
          frameworkId: c.frameworkId,
          metrics: c.metrics
            ? { success: c.metrics.success, duration_ms: c.metrics.duration_ms, total_tokens: c.metrics.total_tokens }
            : undefined,
        })),
      ),
    [columnList],
  );
  const answers = useMemo(
    () =>
      cols.map((col) => ({
        label: col.label,
        text: extractFinalAnswer(col.events),
      })),
    // cols is derived per render; memo on the underlying record instead of the array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns],
  );
  if (cols.length === 0) return null;
  const identicalTools =
    comparison.columns.length > 0 &&
    comparison.commonToolPrefix >= Math.max(...comparison.columns.map((c) => c.toolCalls.length), 0) &&
    comparison.columns.every((c) => c.toolCalls.length === comparison.columns[0]!.toolCalls.length);
  const divergeIndex = identicalTools ? -1 : comparison.commonToolPrefix;

  const sorted = [...cols].sort((a, b) => a.metrics!.duration_ms - b.metrics!.duration_ms);
  const fastest = sorted[0];
  const lowestToken = [...cols].sort(
    (a, b) => a.metrics!.total_tokens - b.metrics!.total_tokens,
  )[0];
  const fewestTools = [...cols].sort((a, b) => a.metrics!.tool_calls - b.metrics!.tool_calls)[0];
  const fewestSteps = [...cols].sort((a, b) => a.metrics!.steps - b.metrics!.steps)[0];
  if (!fastest?.metrics || !lowestToken?.metrics || !fewestTools?.metrics || !fewestSteps?.metrics) return null;
  const maxDuration = Math.max(...cols.map((c) => c.metrics!.duration_ms), 1);
  const maxTokens = Math.max(...cols.map((c) => c.metrics!.total_tokens), 1);

  /** Gap verdicts: one chip per metric where the columns actually differ. */
  const verdicts = (
    [
      {
        label: t("arena.report.fastestLabel").replace(/：|:$/, ""),
        values: cols.map((c) => c.metrics!.duration_ms),
        format: (v: number) => `${v.toLocaleString()}ms`,
      },
      {
        label: t("arena.report.lowestTokenLabel").replace(/：|:$/, ""),
        values: cols.map((c) => c.metrics!.total_tokens),
        format: (v: number) => v.toLocaleString(),
      },
      {
        label: t("arena.report.fewestToolsLabel").replace(/：|:$/, ""),
        values: cols.map((c) => c.metrics!.tool_calls),
        format: (v: number) => `${v}`,
      },
      {
        label: t("arena.report.fewestStepsLabel").replace(/：|:$/, ""),
        values: cols.map((c) => c.metrics!.steps),
        format: (v: number) => `${v}`,
      },
    ] as const
  ).flatMap((metric) => {
    const min = Math.min(...metric.values);
    const max = Math.max(...metric.values);
    if (min === max) return [];
    const winners = cols.filter((c, i) => metric.values[i] === min).map((c) => show(c.label));
    const pct = max > 0 ? Math.round((1 - min / max) * 100) : 0;
    return [{ label: metric.label, winners, detail: `${metric.format(min)} · -${pct}%` }];
  });
  const judged = cols.filter((c) => c.judge);
  const judgePassed = judged.filter((c) => c.judge?.passed).length;

  const ablationRows = report?.ablation?.rows ?? [];
  const { body: narrativeBodyRaw, ablation: narrativeAblation } = splitNarrative(report?.narrative ?? "");
  const narrativeBody = cleanNarrativeBody(narrativeBodyRaw);

  const artifactRows = report?.columns
    ? Object.entries(report.columns).map(([label, data]) => ({
        label,
        fileCount: data.artifacts?.file_count ?? data.artifacts?.files?.length ?? 0,
        tree: data.artifacts?.tree ?? "",
        snippets: data.artifacts?.snippets ?? {},
        steps: data.steps ?? "",
      }))
    : [];

  return (
    <div className="space-y-4 fade-in">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-primary" />
        <h3 className="page-title text-base">{t("arena.report.title")}</h3>
        {report?.question && (
          <span className="truncate text-xs text-muted-foreground" title={report.question}>
            {report.question}
          </span>
        )}
      </div>

      <section className="report-verdict" aria-label={t("arena.report.verdictTitle")}>
        <p className="eyebrow">{t("arena.report.verdictTitle")}</p>
        {verdicts.length === 0 && judged.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("arena.report.verdictEmpty")}</p>
        ) : (
          <div className="report-verdict-chips">
            {verdicts.map((verdict) => (
              <span key={verdict.label} className="report-verdict-chip">
                <span className="report-verdict-key">{verdict.label}</span>
                <span className="report-verdict-winner">{verdict.winners.join(" / ")}</span>
                <span className="report-verdict-detail font-mono">{verdict.detail}</span>
              </span>
            ))}
            {judged.length > 0 && (
              <span className="report-verdict-chip" data-tone={judgePassed === judged.length ? "good" : "bad"}>
                <span className="report-verdict-key">{t("arena.report.autoJudgeLabel").replace(/：|:$/, "")}</span>
                <span className="report-verdict-winner font-mono">
                  {judgePassed} / {judged.length}
                </span>
                <span className="report-verdict-detail">
                  {judgePassed === judged.length
                    ? t("arena.report.autoJudgePassNote")
                    : // Surface WHY columns failed instead of a bare count: the first
                      // failing judge reason is the fastest signal for the reader.
                      (judged.find((c) => !c.judge?.passed)?.judge?.reason ?? "").slice(0, 120)}
                </span>
              </span>
            )}
          </div>
        )}
      </section>

      <AnswerAlignment
        columns={comparison.columns}
        states={comparison.columns.map((col) => columnList.find((c) => c.label === col.label))}
        resolveLabel={show}
      />

      <PipelineConfigCompare columns={columnList} resolveLabel={show} />

      <div className="data-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th className="!text-right">{t("arena.report.colDuration")}</th>
              <th className="!text-right">Token</th>
              <th className="!text-right">{t("arena.report.colTools")}</th>
              <th className="!text-right">{t("arena.report.colSteps")}</th>
              <th className="!text-center">{t("arena.report.colStatus")}</th>
              <th className="!text-center">{t("arena.report.colJudge")}</th>
            </tr>
          </thead>
          <tbody>
            {cols.map((col) => {
              const isFastest = col.metrics!.duration_ms === fastest.metrics!.duration_ms;
              const isLowest = col.metrics!.total_tokens === lowestToken.metrics!.total_tokens;
              const isFewestTools = col.metrics!.tool_calls === fewestTools.metrics!.tool_calls;
              const isFewestSteps = col.metrics!.steps === fewestSteps.metrics!.steps;
              return (
                <tr key={col.label}>
                  <td className="font-medium">{show(col.label)}</td>
                  <td
                    className={
                      "text-right font-mono " +
                      (isFastest ? "metric-best" : "text-muted-foreground")
                    }
                  >
                    <span className="block">{col.metrics!.duration_ms}ms</span>
                    <span className="mt-1 block h-1 overflow-hidden rounded-none bg-muted/60">
                      <span
                        className="block h-full rounded-none bg-primary/70"
                        style={{ width: `${Math.round((col.metrics!.duration_ms / maxDuration) * 100)}%` }}
                      />
                    </span>
                    {isFastest && <span className="metric-best-mark">{t("arena.report.fastestMark")}</span>}
                  </td>
                  <td
                    className={
                      "text-right font-mono " +
                      (isLowest ? "metric-best" : "text-muted-foreground")
                    }
                  >
                    <span className="block">{col.metrics!.total_tokens.toLocaleString()}</span>
                    <span className="mt-1 block h-1 overflow-hidden rounded-none bg-muted/60">
                      <span
                        className="block h-full rounded-none bg-success/70"
                        style={{ width: `${Math.round((col.metrics!.total_tokens / maxTokens) * 100)}%` }}
                      />
                    </span>
                    {isLowest && <span className="metric-best-mark">{t("arena.report.lowestMark")}</span>}
                  </td>
                  <td className={"text-right font-mono " + (isFewestTools ? "metric-best" : "text-muted-foreground")}>
                    {col.metrics!.tool_calls}
                    {isFewestTools && <span className="metric-best-mark">{t("arena.report.fewestMark")}</span>}
                  </td>
                  <td className={"text-right font-mono " + (isFewestSteps ? "metric-best" : "text-muted-foreground")}>
                    {col.metrics!.steps}
                    {isFewestSteps && <span className="metric-best-mark">{t("arena.report.fewestMark")}</span>}
                  </td>
                  <td className="text-center">
                    {col.metrics!.success ? (
                      <span className="inline-flex items-center gap-1.5 text-success">
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        {t("arena.report.success")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-destructive">
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        {t("arena.report.failed")}
                      </span>
                    )}
                  </td>
                  <td className="text-center">
                    {col.judge ? (
                      <span
                        className={
                          "inline-flex items-center gap-1 font-mono text-[11px] " +
                          (col.judge.passed ? "text-success" : "text-destructive")
                        }
                        title={col.judge.reason}
                      >
                        {col.judge.passed ? (
                          <CircleCheck className="h-3 w-3" aria-hidden />
                        ) : (
                          <CircleX className="h-3 w-3" aria-hidden />
                        )}{" "}
                        {t("arena.report.colJudge")}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-[11px]">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-muted-foreground">
        <p>
          {t("arena.report.fastestLabel")}
          <span className="font-medium text-foreground"> {show(fastest.label)}</span>
          <span className="font-mono"> · {fastest.metrics!.duration_ms}ms</span>
        </p>
        <p>
          {t("arena.report.lowestTokenLabel")}
          <span className="font-medium text-foreground"> {show(lowestToken.label)}</span>
          <span className="font-mono">
            {" "}
            · {lowestToken.metrics!.total_tokens.toLocaleString()}
          </span>
        </p>
        <p>
          {t("arena.report.fewestToolsLabel")}
          <span className="font-medium text-foreground"> {show(fewestTools.label)}</span>
          <span className="font-mono"> · {fewestTools.metrics!.tool_calls}</span>
        </p>
        <p>
          {t("arena.report.fewestStepsLabel")}
          <span className="font-medium text-foreground"> {show(fewestSteps.label)}</span>
          <span className="font-mono"> · {fewestSteps.metrics!.steps}</span>
        </p>
        {cols.some((c) => c.judge) && (
          <p className="text-[11px]">
            {t("arena.report.autoJudgeLabel")}
            <span className="font-medium text-foreground">
              {cols.filter((c) => c.judge?.passed).length} / {cols.filter((c) => c.judge).length}
            </span>{" "}
            {t("arena.report.autoJudgePassNote")}
          </p>
        )}
      </div>

      <section className="panel-surface !shadow-none p-4 space-y-3">
        <div className="flex items-center gap-2">
          <MessageSquareText className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold">{t("arena.report.answersTitle")}</h4>
        </div>
        <EntityOverlap columns={comparison.columns} resolveLabel={show} />
        <div className="grid gap-3 md:grid-cols-2">
          {answers.map((row) => (
            <div key={row.label} className="rounded-none border border-border bg-muted/20 p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{show(row.label)}</span>
                <span className="text-[11px] font-mono text-muted-foreground">
                  {t("arena.report.answerChars", { count: row.text.length })}
                </span>
              </div>
              {row.text === "" ? (
                <p className="text-[11px] italic text-muted-foreground">{t("arena.diff.noAnswer")}</p>
              ) : (
                <details className="text-xs" open={answers.length === 1}>
                  <summary className="cursor-pointer text-muted-foreground">
                    {row.text.slice(0, 120)}{row.text.length > 120 ? "…" : ""}
                  </summary>
                  <div className="prose prose-sm dark:prose-invert mt-2 max-h-56 overflow-auto max-w-none prose-p:my-1 prose-p:text-foreground">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{row.text.slice(0, 2000)}</ReactMarkdown>
                  </div>
                </details>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="panel-surface !shadow-none p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold">{t("arena.report.toolsTitle")}</h4>
          <span
            className={
              "ml-auto inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-1.5 py-0.5 font-mono text-[11px] " +
              (identicalTools
                ? "border-success/30 bg-success/10 text-success"
                : "border-warning/30 bg-warning/10 text-warning")
            }
          >
            {identicalTools
              ? t("arena.diff.identical")
              : t("arena.diff.commonPrefix", { count: comparison.commonToolPrefix })}
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {comparison.columns.map((col) => (
            <div key={col.label} className="rounded-none border border-border bg-muted/20 p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{show(col.label)}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{col.toolCalls.length}</span>
              </div>
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
                        {diverged && (
                          <span className="shrink-0 text-[10px] uppercase opacity-80">{t("arena.diff.difference")}</span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          ))}
        </div>
      </section>

      {ablationRows.length > 0 && (
        <section className="panel-surface !shadow-none p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold">{t("arena.report.ablationTitle")}</h4>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{t("arena.report.ablationNote")}</p>
          <div className="data-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th className="!text-right">{t("arena.report.colTools")}</th>
                  <th className="!text-right">{t("arena.report.colMcp")}</th>
                  <th className="!text-right">{t("arena.report.colSkills")}</th>
                  <th className="!text-right">{t("arena.report.colReflects")}</th>
                  <th className="!text-right">{t("arena.report.colAnswerChars")}</th>
                  <th className="!text-right">{t("arena.report.colTrajectory")}</th>
                  <th className="!text-center">{t("arena.report.colJudge")}</th>
                </tr>
              </thead>
              <tbody>
                {ablationRows.map((row) => (
                  <tr key={row.label}>
                    <td className="font-medium">{show(row.label)}</td>
                    <td className="text-right font-mono text-muted-foreground">{row.tool_calls}</td>
                    <td className="text-right font-mono text-muted-foreground">
                      {row.mcp_calls}
                      <span className="ml-1 text-muted-foreground">{Math.round(row.mcp_share * 100)}%</span>
                    </td>
                    <td className="text-right font-mono text-muted-foreground">{row.skill_reads}</td>
                    <td className="text-right font-mono text-muted-foreground">{row.reflects}</td>
                    <td className="text-right font-mono text-muted-foreground">{row.answer_chars.toLocaleString()}</td>
                    <td className="text-right font-mono text-[11px]">
                      {row.trajectory_score !== null && row.trajectory_score !== undefined ? (
                        <span
                          className={
                            "font-medium " +
                            (row.trajectory_score >= 0.6 ? "text-success" : "text-warning")
                          }
                        >
                          {(row.trajectory_score * 100).toFixed(0)}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="text-center font-mono text-[11px]">
                      {row.judge_passed === null || row.judge_passed === undefined ? (
                        <span className="text-muted-foreground">—</span>
                      ) : row.judge_passed ? (
                        <CircleCheck className="inline h-3 w-3 text-success" aria-label={t("arena.results.judgePass")} />
                      ) : (
                        <CircleX className="inline h-3 w-3 text-destructive" aria-label={t("arena.results.judgeFail")} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {report?.trajectories && Object.keys(report.trajectories).length > 0 && (
            <div className="mt-3 space-y-2 pt-2 border-t border-border/40">
              <p className="eyebrow">{t("arena.report.colTrajectory")}</p>
              <div className="grid gap-2 md:grid-cols-2">
                {Object.entries(report.trajectories).map(([label, traj]) => (
                  <div key={label} className="rounded border border-border/60 bg-muted/10 p-2.5 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between font-medium">
                      <span>{show(label)}</span>
                      <span className={traj.passed ? "text-success font-mono" : "text-warning font-mono"}>
                        {(traj.overall * 100).toFixed(0)}% · {traj.passed ? "PASS" : "FAIL"}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{traj.summary}</p>
                    <div className="grid grid-cols-2 gap-1 text-[10px] font-mono pt-1 text-muted-foreground">
                      {Object.values(traj.dimensions).map((dim) => (
                        <div key={dim.dimension} className="flex justify-between border-b border-border/20 py-0.5">
                          <span>{dim.dimension}:</span>
                          <span className={dim.score >= 0.7 ? "text-foreground font-semibold" : "text-warning"}>
                            {(dim.score * 100).toFixed(0)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {artifactRows.length > 0 && (
        <section className="panel-surface !shadow-none p-4 space-y-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold">{t("arena.report.artifactsTitle")}</h4>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {artifactRows.map((row) => (
              <div
                key={row.label}
                className="rounded-none border border-border bg-muted/20 p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{show(row.label)}</span>
                  <span className="text-[11px] font-mono text-muted-foreground">
                    {t("arena.report.fileCount", { count: row.fileCount })}
                  </span>
                </div>
                {row.steps && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">{t("arena.report.stepsSummary")}</summary>
                    <pre className="mt-2 text-[11px] font-mono whitespace-pre-wrap break-words text-muted-foreground max-h-40 overflow-auto">
                      {row.steps}
                    </pre>
                  </details>
                )}
                {row.tree && (
                  <pre className="text-[11px] font-mono whitespace-pre-wrap break-words text-muted-foreground max-h-32 overflow-auto">
                    {row.tree}
                  </pre>
                )}
                {Object.keys(row.snippets).length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">{t("arena.report.snippetsSummary")}</summary>
                    <div className="mt-2 space-y-2">
                      {Object.entries(row.snippets)
                        .slice(0, 3)
                        .map(([path, snippet]) => (
                          <div key={path}>
                            <p className="font-mono text-[11px] text-foreground">{path}</p>
                            <pre className="mt-1 text-[11px] font-mono whitespace-pre-wrap break-all text-muted-foreground max-h-24 overflow-auto">
                              {snippet.slice(0, 400)}
                              {snippet.length > 400 ? "\n…" : ""}
                            </pre>
                          </div>
                        ))}
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel-surface !shadow-none p-4 space-y-2">
        <h4 className="text-sm font-semibold">{t("arena.report.narrativeTitle")}</h4>
        {narrativeBody !== "" ? (
          <div
            className="prose prose-sm dark:prose-invert max-w-none
              prose-p:my-2 prose-p:text-foreground
              prose-headings:text-foreground prose-headings:my-2"
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{narrativeBody}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">{t("arena.report.narrativeEmpty")}</p>
        )}
        {narrativeAblation !== "" && (
          <p className="border-t border-border pt-2 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
            {narrativeAblation}
          </p>
        )}
      </section>

      {report && (
        <details className="panel-surface !shadow-none p-4">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
            <Braces className="h-4 w-4 text-primary" aria-hidden />
            {t("arena.report.rawTitle")}
            <span className="ml-auto">
              <CopyButton text={JSON.stringify(report, null, 2)} />
            </span>
          </summary>
          <pre className="mt-2 max-h-96 overflow-auto rounded-none border border-border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-all">
            {JSON.stringify(report, null, 2).slice(0, 20000)}
          </pre>
        </details>
      )}
    </div>
  );
}
