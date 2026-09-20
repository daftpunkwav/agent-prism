/**
 * @file useArenaAutoJudge
 * @description Auto-judging once a run completes.
 *
 * Responsibilities:
 * - Trigger judging per template+question, keyed to avoid duplicates
 * - Write results back into column state
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { judgeAnswers } from "@agentprism/client";
import type { TaskTemplate } from "@agentprism/client";
import type { ColumnState } from "@agentprism/arena-view";
import type { JudgeResult } from "@agentprism/client";
import { extractFinalAnswer } from "@agentprism/arena-view";
import { useT } from "@/i18n/useT";

/** Auto-judges settled columns with the active template and writes results back. */
export function useArenaAutoJudge(options: {
  allCompleted: boolean;
  activeTemplateId: string | null;
  templates: TaskTemplate[];
  question: string;
  columnList: ColumnState[];
  /** Judge-result writeback (the named column writer provided by useArenaStream) */
  applyJudgeResults: (results: Record<string, JudgeResult>) => void;
  setError: (msg: string | null) => void;
}) {
  const {
    allCompleted,
    activeTemplateId,
    templates,
    question,
    columnList,
    applyJudgeResults,
    setError,
  } = options;
  const t = useT();
  const [judging, setJudging] = useState(false);
  const judgedRef = useRef<string | null>(null);

  const resetJudge = useCallback(() => {
    judgedRef.current = null;
  }, []);

  useEffect(() => {
    if (!allCompleted || !activeTemplateId || judging || !question.trim()) return;
    const tpl = templates.find((candidate) => candidate.id === activeTemplateId);
    if (!tpl || tpl.judge.type === "none" || tpl.category === "quick") return;
    const runKey = `${activeTemplateId}:${question.trim()}`;
    if (judgedRef.current === runKey) return;
    const answers: Record<string, string> = {};
    for (const c of columnList) {
      const text = extractFinalAnswer(c.events);
      if (text) answers[c.label] = text;
    }
    if (Object.keys(answers).length === 0) return;
    judgedRef.current = runKey;
    setJudging(true);
    judgeAnswers(activeTemplateId, answers)
      .then((results) => {
        applyJudgeResults(results);
      })
      .catch((err: Error) => {
        judgedRef.current = null; // failures do not lock; later triggers can retry
        console.error("Judging failed:", err);
        setError(err instanceof Error ? err.message : t("arena.judge.failed"));
      })
      .finally(() => setJudging(false));
  }, [
    allCompleted,
    activeTemplateId,
    judging,
    columnList,
    question,
    templates,
    applyJudgeResults,
    setError,
    t,
  ]);

  return { judging, resetJudge };
}
