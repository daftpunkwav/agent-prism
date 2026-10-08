/**
 * @file AnswerGalleryView
 * @description Fun answers-only view: each column's final reply as a gallery card.
 *
 * Responsibilities:
 * - Render one card per column holding only the final answer digest
 * - Truncate long answers with an expand/collapse toggle
 * - Show status and judge verdict chips without any trace detail
 */

"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ColumnState } from "@agentprism/arena-view";
import { useT } from "@/i18n/useT";
import { MarkdownBlock } from "@/components/MarkdownBlock";
import { summarizeColumns } from "./viewData";

/** Answers longer than this render collapsed with an expander. */
const PREVIEW_CHARS = 600;

/** One gallery card: header chips plus the answer body (clamped unless expanded). */
function GalleryCard({ answer, settled, success, judgePassed, display }: {
  answer: string;
  settled: boolean;
  success: boolean;
  judgePassed: boolean | null;
  display: string;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const clamped = answer.length > PREVIEW_CHARS;
  const body = expanded || !clamped ? answer : answer.slice(0, PREVIEW_CHARS);
  return (
    <article className="arena-gallery-card" data-lane={0} data-state={settled ? (success ? "ok" : "fail") : "running"}>
      <header className="arena-gallery-head">
        <span className="column-title truncate">{display}</span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {!settled
            ? t("arena.view.galleryRunning")
            : success
              ? t("arena.view.galleryOk")
              : t("arena.view.galleryFail")}
          {judgePassed !== null && (
            <span className={judgePassed ? "arena-gallery-judge-pass" : "arena-gallery-judge-fail"}>
              {" · "}
              {judgePassed ? t("arena.results.judgePass") : t("arena.results.judgeFail")}
            </span>
          )}
        </span>
      </header>
      <div className="arena-gallery-body">
        {answer ? (
          <MarkdownBlock text={body} />
        ) : (
          <p className="text-xs text-muted-foreground">{t("arena.diff.noAnswer")}</p>
        )}
      </div>
      {clamped && (
        <button
          type="button"
          className="btn-ghost arena-gallery-expander !h-7 !px-2 text-[11px]"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" aria-hidden />
              {t("arena.diff.collapse")}
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" aria-hidden />
              {t("arena.diff.expand", { count: answer.length })}
            </>
          )}
        </button>
      )}
    </article>
  );
}

/** Answers-only gallery: reading comparison without execution detail. */
export function AnswerGalleryView({ columnList, resolveDisplayLabel }: {
  columnList: ColumnState[];
  /** Locale-resolved display label for a pipeline label. */
  resolveDisplayLabel: (label: string) => string;
}) {
  const t = useT();
  const summaries = summarizeColumns(columnList);

  if (summaries.length === 0) {
    return (
      <div className="empty-state h-full">
        <p className="text-sm">{t("arena.view.galleryEmpty")}</p>
      </div>
    );
  }

  return (
    <div className="arena-stage-scroll arena-gallery">
      <div className="arena-gallery-grid">
        {summaries.map((s) => (
          <GalleryCard
            key={s.label}
            display={resolveDisplayLabel(s.label)}
            answer={s.answer}
            settled={s.settled}
            success={s.success}
            judgePassed={s.judgePassed}
          />
        ))}
      </div>
    </div>
  );
}
