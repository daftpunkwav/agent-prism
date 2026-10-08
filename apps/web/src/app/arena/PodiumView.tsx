/**
 * @file PodiumView
 * @description Race view: live runners on tracks with speech bubbles; a podium
 *              emerges once every runner has finished.
 *
 * Responsibilities:
 * - Render one lane-colored track per column with an animated runner dot
 * - Show each runner's current activity in a speech bubble (what it is doing now)
 * - Hold the podium until every column settled, then reveal 1st/2nd/3rd places
 *
 * Poll-free: progress re-derives on every stream event render; the elapsed clock
 * uses a light 1s interval only while the race is running.
 */

"use client";

import { useEffect, useState } from "react";
import { BookOpenText, CheckCircle2, Flag, Gavel, Search, Wrench, XCircle } from "lucide-react";
import type { ColumnState } from "@agentprism/arena-view";
import { useT } from "@/i18n/useT";
import { runnerStates, summarizeColumns, type ColumnSummary, type RunnerState } from "./viewData";

/** Ranking order for the finished podium: judged-pass first, then success, then faster duration. */
function rankCompare(a: ColumnSummary, b: ColumnSummary): number {
  const judgeRank = (s: ColumnSummary) => (s.judgePassed === null ? 0 : s.judgePassed ? 2 : 1);
  if (judgeRank(a) !== judgeRank(b)) return judgeRank(b) - judgeRank(a);
  if (a.success !== b.success) return a.success ? -1 : 1;
  return a.durationMs - b.durationMs;
}

/** Bubble icon per activity kind. */
function ActivityIcon({ kind, tool }: { kind: RunnerState["activityKind"]; tool: string }) {
  if (kind === "action") {
    // A wrench reads generic; a magnifier hints probing tools when the tool name is one.
    return tool ? <Search className="h-3 w-3 shrink-0" aria-hidden /> : <Wrench className="h-3 w-3 shrink-0" aria-hidden />;
  }
  if (kind === "verify") return <Gavel className="h-3 w-3 shrink-0" aria-hidden />;
  if (kind === "done") return <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden />;
  if (kind === "error") return <XCircle className="h-3 w-3 shrink-0" aria-hidden />;
  return <BookOpenText className="h-3 w-3 shrink-0" aria-hidden />;
}

/** The runner dot, result chip, and speech bubble inside one track strip. */
function TrackBody({ runner, waiting, bubbleText }: { runner: RunnerState; waiting: boolean; bubbleText: string }) {
  const t = useT();
  return (
    <div className="arena-track">
      <div className="arena-track-surface" aria-hidden>
        <span className="arena-track-lane-line" />
        <span className="arena-track-lane-line" />
        <span className="arena-track-lane-line" />
      </div>
      {runner.settled && (
        <span
          className={`arena-track-result font-mono text-[11px] ${runner.success ? "text-success" : "text-destructive"}`}
        >
          {runner.success ? t("arena.view.galleryOk") : t("arena.view.galleryFail")}
        </span>
      )}
      {!waiting && (
        // No role="status": several lanes updating independently would spam
        // screen readers; the race hint below is the single live region.
        <div className="arena-track-bubble">
          <ActivityIcon kind={runner.activityKind} tool={runner.tool} />
          <span className="arena-track-bubble-text">{bubbleText}</span>
        </div>
      )}
      <div className="arena-track-runner" style={{ left: `${Math.min(runner.progress * 100, 100)}%` }}>
        <span className="arena-track-runner-body" aria-hidden />
      </div>
      <Flag className="arena-track-flag" size={14} aria-hidden />
    </div>
  );
}

/** One track lane: label, speech bubble, and the runner dot racing to the flag. */
function TrackLane({ runner, lane, display }: { runner: RunnerState; lane: number; display: string }) {
  const t = useT();
  const waiting = runner.progress <= 0 && !runner.settled;
  const bubbleText = runner.settled
    ? runner.success
      ? t("arena.view.raceFinished")
      : t("arena.view.raceFailed")
    : runner.activity || t("arena.view.racePreparing");
  const progressPct = Math.min(runner.progress * 100, 100);
  return (
    <div className="arena-track-lane" data-lane={lane} data-settled={runner.settled ? (runner.success ? "ok" : "fail") : undefined}>
      <div className="arena-track-head">
        <span className="column-title truncate" title={display}>
          {display}
        </span>
        <span className="arena-track-elapsed font-mono text-[11px] text-muted-foreground">
          {runner.elapsedMs > 0 ? `${(runner.elapsedMs / 1000).toFixed(1)}s` : ""}
        </span>
      </div>
      <TrackBody runner={runner} waiting={waiting} bubbleText={bubbleText} />
      <div className="arena-track-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressPct)} aria-label={t("arena.view.raceProgressAria", { name: display })}>
        <span style={{ width: `${progressPct}%` }} />
      </div>
    </div>
  );
}

/** The podium, revealed only when every runner has finished. */
function FinishedPodium({ ranked, resolveDisplayLabel }: {
  ranked: ColumnSummary[];
  resolveDisplayLabel: (label: string) => string;
}) {
  const t = useT();
  const podium = ranked.slice(0, 3);
  const rest = ranked.slice(3);
  return (
    <div className="arena-race-podium-wrap">
      <p className="arena-race-podium-title text-xs font-medium text-muted-foreground">
        {t("arena.view.racePodiumTitle")}
      </p>
      <div className="arena-podium-top">
        {podium.map((summary, place) => {
          const placeLabel = t(`arena.view.podiumPlace${place + 1}` as "arena.view.podiumPlace1");
          return (
            <div key={summary.label} className="arena-podium-card" data-place={place} data-lane={place}>
              <div className="arena-podium-place font-mono" aria-hidden>
                {place + 1}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="column-title truncate">{resolveDisplayLabel(summary.label)}</span>
                </div>
                <p className="arena-podium-meta font-mono text-[11px] text-muted-foreground">
                  {t("arena.view.podiumMeta", {
                    duration: summary.durationMs.toLocaleString(),
                    tokens: summary.totalTokens.toLocaleString(),
                    tools: `${summary.toolCalls}`,
                  })}
                </p>
                <p className="arena-podium-verdict text-[11px]">
                  {summary.judgePassed === null
                    ? t("arena.view.podiumNoJudge")
                    : summary.judgePassed
                      ? t("arena.results.judgePass")
                      : t("arena.results.judgeFail")}
                </p>
              </div>
              <span className="sr-only">{placeLabel}</span>
            </div>
          );
        })}
      </div>
      {rest.length > 0 && (
        <ol className="arena-podium-rest">
          {rest.map((summary, idx) => (
            <li key={summary.label} className="arena-podium-row" data-lane={(idx + 3) % 4}>
              <span className="arena-podium-row-place font-mono" aria-hidden>
                {idx + 4}
              </span>
              <span className="column-title truncate">{resolveDisplayLabel(summary.label)}</span>
              <span className="arena-podium-meta font-mono text-[11px] text-muted-foreground">
                {`${summary.durationMs.toLocaleString()}ms · ${summary.totalTokens.toLocaleString()} tok`}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Race view: live tracks while running, podium after every column settles. */
export function PodiumView({ columnList, running, resolveDisplayLabel }: {
  columnList: ColumnState[];
  /** True while the arena run is streaming (drives the elapsed clock). */
  running: boolean;
  /** Locale-resolved display label for a pipeline label. */
  resolveDisplayLabel: (label: string) => string;
}) {
  const t = useT();
  // A 1s clock only while the run is streaming with unsettled columns: elapsed
  // times tick and the runner dots re-derive without waiting for stream events.
  // A stop/cancel sets running=false with metrics absent — the clock must not
  // keep ticking then.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const anyUnsettled = running && columnList.some((col) => col.metrics === undefined);
  useEffect(() => {
    if (!anyUnsettled) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [anyUnsettled]);

  const runners = runnerStates(columnList, nowMs);
  const summaries = summarizeColumns(columnList);
  const allSettled = columnList.length > 0 && columnList.every((col) => col.metrics !== undefined);

  if (columnList.length === 0) {
    return (
      <div className="empty-state h-full">
        <p className="text-sm">{t("arena.view.podiumEmpty")}</p>
      </div>
    );
  }

  return (
    <div className="arena-stage-scroll arena-race">
      <div className="arena-race-tracks">
        {runners.map((runner, idx) => (
          <TrackLane
            key={runner.label}
            runner={runner}
            lane={idx % 4}
            display={resolveDisplayLabel(runner.label)}
          />
        ))}
      </div>
      {allSettled && <FinishedPodium ranked={[...summaries].sort(rankCompare)} resolveDisplayLabel={resolveDisplayLabel} />}
      {!allSettled && (
        // Single polite live region for the whole race: lane bubbles update
        // visually only, so assistive tech gets one summary, not a chorus.
        <p className="arena-race-hint text-[11px] text-muted-foreground" aria-live="polite">
          {running ? t("arena.view.raceHintRunning") : t("arena.view.raceHintWaiting")}
        </p>
      )}
    </div>
  );
}
