/**
 * @file useColumnSessions
 * @description Independent per-column chat transcripts and workspace names.
 *
 * Responsibilities:
 * - Keep one transcript and workspace name per comparison column
 * - Continue each column from its own last turn
 * - Copy one column's transcript onto the others only on explicit action
 */

"use client";

import { useCallback, useState } from "react";
import { MAX_COLUMN_SESSION_MESSAGES, MAX_HISTORY_CHARS, type ChatMessage, type ColumnSession, type ToolRound } from "@agentprism/client";
import { useT } from "@/i18n/useT";

export type ColumnSessionState = {
  messages: ChatMessage[];
  workspace?: string;
};

function trimToBudget(messages: ChatMessage[], question: string): ChatMessage[] {
  const budget = MAX_HISTORY_CHARS - question.length;
  let total = 0;
  let keepFrom = messages.length;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    total += (messages[i]?.content ?? "").length;
    if (total > budget) break;
    keepFrom = i;
  }
  if (keepFrom % 2 === 1) keepFrom += 1;
  const kept = keepFrom === 0 ? messages : messages.slice(keepFrom);
  // The backend zod caps a session transcript at MAX_COLUMN_SESSION_MESSAGES rows;
  // histories are always appended in user/assistant pairs (even length), so the
  // tail slice keeps the pairing and the user-first alternation intact.
  return kept.length > MAX_COLUMN_SESSION_MESSAGES ? kept.slice(-MAX_COLUMN_SESSION_MESSAGES) : kept;
}

function clipAnswer(text: string): string {
  return text.length <= 4000 ? text : text.slice(0, 4000);
}

/**
 * Single source of turn derivation (aligned with the backend formula
 * ``len(messages)//2 + 1``). A module-level pure function shared by session
 * transcripts and useArenaStream's run stripping, avoiding dual-source drift.
 */
export function deriveTurn(messages: ChatMessage[]): number {
  return Math.floor(messages.length / 2) + 1;
}

/** Independent per-column sessions for Arena follow-ups. */
export function useColumnSessions() {
  const t = useT();
  const [sessions, setSessions] = useState<Record<string, ColumnSessionState>>({});

  const pushColumnTurn = useCallback(
    (label: string, question: string, answer: string, toolRounds?: ToolRound[]) => {
      setSessions((prev) => {
        const current = prev[label] ?? { messages: [] };
        const nextMessages: ChatMessage[] = [
          ...current.messages,
          { role: "user", content: question },
          {
            role: "assistant",
            content: clipAnswer(answer || t("arena.history.noReply")),
            ...(toolRounds !== undefined && toolRounds.length > 0 ? { tool_rounds: toolRounds } : {}),
          },
        ];
        return {
          ...prev,
          [label]: {
            ...current,
            messages: trimToBudget(nextMessages, question),
          },
        };
      });
    },
    [t],
  );

  const rememberWorkspace = useCallback((label: string, workspace: string) => {
    if (workspace.trim() === "") return;
    setSessions((prev) => {
      const current = prev[label] ?? { messages: [] };
      if (current.workspace === workspace) return prev;
      return { ...prev, [label]: { ...current, workspace } };
    });
  }, []);

  /** Copies one column's transcript onto the others; disk workspaces stay isolated. */
  const copyTranscriptToAll = useCallback((sourceLabel: string, targetLabels: string[]) => {
    setSessions((prev) => {
      const source = prev[sourceLabel];
      if (source === undefined) return prev;
      const copied = source.messages.map((m) => ({ ...m }));
      const next = { ...prev };
      for (const label of targetLabels) {
        const current = next[label] ?? { messages: [] };
        next[label] = { ...current, messages: copied.map((m) => ({ ...m })) };
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setSessions({});
  }, []);

  const snapshotFor = useCallback(
    (labels: string[]): Record<string, ColumnSession> => {
      const out: Record<string, ColumnSession> = {};
      for (const label of labels) {
        const session = sessions[label];
        if (session === undefined) continue;
        if (session.messages.length === 0 && session.workspace === undefined) continue;
        out[label] = {
          messages: session.messages,
          ...(session.workspace ? { workspace: session.workspace } : {}),
        };
      }
      return out;
    },
    [sessions],
  );

  return {
    sessions,
    pushColumnTurn,
    rememberWorkspace,
    copyTranscriptToAll,
    reset,
    snapshotFor,
  };
}
