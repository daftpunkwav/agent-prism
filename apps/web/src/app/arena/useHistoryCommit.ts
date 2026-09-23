/**
 * @file useHistoryCommit
 * @description Commits settled turns into each column's independent session.
 *
 * Responsibilities:
 * - Append the question and each column's final answer after the run settles
 * - Seed transcripts only on explicit user copy actions
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ColumnState } from "@agentprism/arena-view";
import { eventTurn, extractFinalAnswer } from "@agentprism/arena-view";
import { extractToolRounds, type ToolRound } from "@agentprism/client";
import { useT } from "@/i18n/useT";

/** Commits settled column turns into per-column chat history plus workspace memory. */
export function useHistoryCommit(options: {
  running: boolean;
  allSettled: boolean;
  columns: Record<string, ColumnState>;
  columnList: ColumnState[];
  pushColumnTurn: (label: string, question: string, answer: string, toolRounds?: ToolRound[]) => void;
  rememberWorkspace: (label: string, workspace: string) => void;
  /** Post-commit coordination (upstream clears the input box). */
  onCommitted: () => void;
}) {
  const { running, allSettled, columns, columnList, pushColumnTurn, rememberWorkspace, onCommitted } = options;
  const t = useT();
  const [historySeedLabel, setHistorySeedLabel] = useState<string | null>(null);
  /** Per-column turn numbers of the pending run (same formula the backend annotates events with). */
  const pendingRef = useRef<{ turns: Record<string, number>; question: string } | null>(null);

  const beginTurn = useCallback((turns: Record<string, number>, question: string) => {
    pendingRef.current = { turns, question };
  }, []);

  const cancelTurn = useCallback(() => {
    pendingRef.current = null;
  }, []);

  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending || running || !allSettled) return;
    pendingRef.current = null;
    for (const col of columnList) {
      if (!col.metrics && !col.error) continue;
      const extracted = extractFinalAnswer(col.events);
      const answer = extracted || col.error || t("arena.history.noReply");
      // col.events also holds earlier completed turns (kept for the trace view),
      // so rounds must come from this turn's events only or they duplicate every turn.
      const turn = pending.turns[col.label] ?? 0;
      pushColumnTurn(col.label, pending.question, answer, extractToolRounds(col.events.filter((event) => eventTurn(event) === turn)));
      if (col.workspace) rememberWorkspace(col.label, col.workspace);
    }
    onCommitted();
  }, [running, allSettled, columns, columnList, pushColumnTurn, rememberWorkspace, onCommitted, t]);

  return { historySeedLabel, setHistorySeedLabel, beginTurn, cancelTurn };
}
