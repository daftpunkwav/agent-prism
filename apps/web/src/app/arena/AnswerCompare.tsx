/**
 * @file AnswerCompare
 * @description Cross-column answer comparison views shared by TraceDiff and ComparisonReport.
 *
 * Responsibilities:
 * - Pick the alignment reference column (judge-passed first, then longest answer)
 * - Render sentence-level answer alignment with per-column similarity badges
 * - Render the objective-fact overlap table (consensus vs column-exclusive)
 *
 * Pure rendering over the answer-compare data layer; no data derivation here.
 */

"use client";

import { useMemo, useState } from "react";
import { Braces, ScrollText } from "lucide-react";
import type { ColumnState } from "@agentprism/arena-view";
import {
  alignAnswers,
  answerSimilarity,
  compareAnswerEntities,
  ENTITY_KINDS,
  type AlignedUnit,
  type TraceCompareColumn,
} from "@agentprism/arena-view";
import { useT } from "@/i18n/useT";

/** Picks the alignment reference: a judge-passed column wins, then the longest answer. */
function pickReference(columns: TraceCompareColumn[], states: Array<ColumnState | undefined>): number {
  const judgeRank = (index: number) => {
    const judge = states[index]?.judge;
    return judge ? (judge.passed ? 2 : 1) : 0;
  };
  let best = 0;
  for (let index = 1; index < columns.length; index++) {
    const candidate = columns[index]!;
    const current = columns[best]!;
    if (judgeRank(index) !== judgeRank(best)) {
      if (judgeRank(index) > judgeRank(best)) best = index;
    } else if (candidate.finalAnswer.length > current.finalAnswer.length) {
      best = index;
    }
  }
  return best;
}

/** One aligned sentence row: shared wording reads quiet, exclusive wording pops. */
function AlignedRow({ row, labelA, labelB }: { row: AlignedUnit; labelA: string; labelB: string }) {
  if (row.kind === "same") {
    return (
      <li className="answer-align-row" data-kind="same">
        <span className="answer-align-text">{row.a}</span>
      </li>
    );
  }
  const text = row.kind === "only-a" ? row.a : row.b;
  const owner = row.kind === "only-a" ? labelA : labelB;
  return (
    <li className="answer-align-row" data-kind={row.kind}>
      <span className="answer-align-owner">{owner}</span>
      <span className="answer-align-text">{text}</span>
    </li>
  );
}

/**
 * Sentence-level answer alignment against one reference column: the similarity
 * badge per compared column, plus the full aligned view for two columns.
 */
export function AnswerAlignment({
  columns,
  states,
  resolveLabel,
}: {
  columns: TraceCompareColumn[];
  states: Array<ColumnState | undefined>;
  resolveLabel: (label: string) => string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const referenceIndex = useMemo(() => pickReference(columns, states), [columns, states]);
  const reference = columns[referenceIndex]!;
  // others/pairwise derive inside useMemo: callers rebuild the states array per
  // render, so filtering during render would invalidate the memo every frame.
  const pairwise = useMemo(() => {
    const others = columns.filter((_, index) => index !== referenceIndex);
    return others.map((col) => ({
      col,
      similarity: answerSimilarity(reference.finalAnswer, col.finalAnswer),
      rows: alignAnswers(reference.finalAnswer, col.finalAnswer),
    }));
  }, [columns, referenceIndex, reference]);
  if (columns.length < 2 || reference.finalAnswer === "") return null;
  return (
    <section className="panel-surface !shadow-none p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <ScrollText className="h-4 w-4 text-primary" aria-hidden />
        <h4 className="text-sm font-semibold">{t("arena.diff.answerAlignTitle")}</h4>
        <span className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[11px] font-mono">
          {t("arena.diff.referenceLabel")}: {resolveLabel(reference.label)}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground">{t("arena.diff.answerAlignNote")}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {pairwise.map(({ col, similarity }) => (
          <span key={col.label} className="inline-flex items-center gap-1.5 text-[11px] font-mono">
            <span className="text-muted-foreground">{resolveLabel(col.label)}</span>
            <span
              className={
                "font-semibold " + (similarity >= 0.6 ? "text-success" : similarity >= 0.3 ? "text-warning" : "text-destructive")
              }
            >
              {Math.round(similarity * 100)}%
            </span>
            <span className="text-muted-foreground">{t("arena.diff.similarityLabel")}</span>
          </span>
        ))}
      </div>
      {pairwise.length === 1 && (
        <details
          open={open}
          onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer text-[11px] font-mono text-muted-foreground">
            {open ? t("arena.diff.collapse") : t("arena.diff.answerAlignTitle")}
          </summary>
          <ul className="answer-align-list mt-2">
            {pairwise[0]!.rows.map((row, index) => (
              <AlignedRow
                key={index}
                row={row}
                labelA={resolveLabel(reference.label)}
                labelB={resolveLabel(pairwise[0]!.col.label)}
              />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** Cross-column fact table: consensus entities vs column-exclusive claims. */
export function EntityOverlap({
  columns,
  resolveLabel,
}: {
  columns: TraceCompareColumn[];
  resolveLabel: (label: string) => string;
}) {
  const t = useT();
  const comparison = useMemo(
    () => compareAnswerEntities(columns.map((col) => ({ label: col.label, text: col.finalAnswer }))),
    [columns],
  );
  const kindLabels: Record<string, string> = {
    paths: t("arena.diff.entityKindPaths"),
    urls: t("arena.diff.entityKindUrls"),
    commands: t("arena.diff.entityKindCommands"),
    numbers: t("arena.diff.entityKindNumbers"),
  };
  // Single-column runs make "shared by all columns" vacuous (every = always true).
  if (columns.length < 2) return null;
  const sharedCount = ENTITY_KINDS.reduce((sum, kind) => sum + comparison.shared[kind].length, 0);
  if (sharedCount === 0 && comparison.partial.length === 0) return null;
  return (
    <section className="panel-surface !shadow-none p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Braces className="h-4 w-4 text-primary" aria-hidden />
        <h4 className="text-sm font-semibold">{t("arena.diff.entityTitle")}</h4>
      </div>
      <p className="text-[11px] text-muted-foreground">{t("arena.diff.entityNote")}</p>
      <div className="data-table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("arena.diff.entityTitle")}</th>
              <th>{t("arena.diff.entityOwner")}</th>
            </tr>
          </thead>
          <tbody>
            {ENTITY_KINDS.flatMap((kind) =>
              comparison.shared[kind].map((entity) => (
                <tr key={`${kind}-shared-${entity}`}>
                  <td className="font-mono text-[11px]">{entity}</td>
                  <td>
                    <span className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-success/30 bg-success/10 px-1.5 py-0.5 text-[11px] font-mono text-success">
                      {t("arena.diff.entityShared")} · {kindLabels[kind]}
                    </span>
                  </td>
                </tr>
              )),
            )}
            {comparison.partial.map(({ entity, kind, columns: owners }) => (
              <tr key={`${kind}-${entity}`}>
                <td className="font-mono text-[11px]">{entity}</td>
                <td>
                  <span className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[11px] font-mono text-warning">
                    {t("arena.diff.onlyIn", { label: owners.map((label) => resolveLabel(label)).join(" / ") })} · {kindLabels[kind]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
