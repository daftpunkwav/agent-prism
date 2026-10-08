/**
 * @file PodiumView
 * @description Fun ranking view: podium of the top three columns plus a ranked roster.
 *
 * Responsibilities:
 * - Rank settled columns by judge verdict, then success, then duration
 * - Render the top three as podium cards (gold/silver/bronze lane accents)
 * - List the remaining columns as compact ranked rows
 */

"use client";

import { Medal } from "lucide-react";
import type { ColumnState } from "@agentprism/arena-view";
import { useT } from "@/i18n/useT";
import { summarizeColumns, type ColumnSummary } from "./viewData";

/** Ranking order: judged-pass first, then success, then faster duration. */
function rankCompare(a: ColumnSummary, b: ColumnSummary): number {
  const judgeRank = (s: ColumnSummary) => (s.judgePassed === null ? 0 : s.judgePassed ? 2 : 1);
  if (judgeRank(a) !== judgeRank(b)) return judgeRank(b) - judgeRank(a);
  if (a.success !== b.success) return a.success ? -1 : 1;
  return a.durationMs - b.durationMs;
}

/** Podium card for one ranked column. */
function PodiumCard({ summary, place, display }: { summary: ColumnSummary; place: 0 | 1 | 2; display: string }) {
  const t = useT();
  const placeLabel = t(`arena.view.podiumPlace${place + 1}` as "arena.view.podiumPlace1");
  return (
    <div className="arena-podium-card" data-place={place} data-lane={place}>
      <div className="arena-podium-place font-mono" aria-hidden>
        {place + 1}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <Medal className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="column-title truncate">{display}</span>
        </div>
        <p className="arena-podium-meta font-mono text-[11px] text-muted-foreground">
          {summary.settled
            ? t("arena.view.podiumMeta", {
                duration: summary.durationMs.toLocaleString(),
                tokens: summary.totalTokens.toLocaleString(),
                tools: `${summary.toolCalls}`,
              })
            : t("arena.view.podiumPending")}
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
}

/** Ranking view: a three-place podium plus a compact roster of the rest. */
export function PodiumView({ columnList, resolveDisplayLabel }: {
  columnList: ColumnState[];
  /** Locale-resolved display label for a pipeline label. */
  resolveDisplayLabel: (label: string) => string;
}) {
  const t = useT();
  const ranked = summarizeColumns(columnList).sort(rankCompare);
  const podium = ranked.slice(0, 3);
  const rest = ranked.slice(3);

  if (ranked.length === 0) {
    return (
      <div className="empty-state h-full">
        <p className="text-sm">{t("arena.view.podiumEmpty")}</p>
      </div>
    );
  }

  return (
    <div className="arena-stage-scroll arena-podium">
      <div className="arena-podium-top">
        {podium.map((summary, place) => (
          <PodiumCard key={summary.label} summary={summary} place={place as 0 | 1 | 2} display={resolveDisplayLabel(summary.label)} />
        ))}
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
                {summary.settled
                  ? `${summary.durationMs.toLocaleString()}ms · ${summary.totalTokens.toLocaleString()} tok`
                  : t("arena.view.podiumPending")}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
