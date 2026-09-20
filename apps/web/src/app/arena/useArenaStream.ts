/**
 * @file useArenaStream
 * @description SSE streaming consumption hook: events in, column state out.
 *
 * Responsibilities:
 * - Merge events by pipeline label
 * - Manage run, abort, and error state
 * - Expose one workspaceRefreshToken for file-panel refresh
 */

"use client";

import { useCallback, useRef, useState } from "react";
import {
  answerArenaQuestion,
  isAbortError,
  stopArenaColumn,
  streamArenaRun,
} from "@agentprism/client";
import type {
  ArenaEvent,
  BaselineOverrides,
  RunAttachment,
  ComparisonReportPayload,
  DimensionId,
  JudgeResult,
  PipelineMetrics,
  TokenStats,
  ColumnSession,
} from "@agentprism/client";
import { askQuestionsOfArgs, type PendingAskBatch } from "@/components/AskUserModal";
import { deriveTurn } from "./useColumnSessions";
import { eventTurn, type ColumnState } from "@agentprism/arena-view";
import { useT } from "@/i18n/useT";

export type RunResult = {
  /** User-initiated cancellation (stop button / unmount) */
  aborted: boolean;
  /** Whole-run failure (network / HTTP error, not a per-column SSE error) */
  failed: boolean;
};

export type RunOptions = {
  question: string;
  dimension: DimensionId;
  selections: string[];
  baseline?: BaselineOverrides;
  /** Independent per-column transcripts and workspace names. */
  columnSessions: Record<string, ColumnSession>;
  /** Columns kept for this run (columns not listed are cleared) */
  preserveColumns: Array<{ label: string; frameworkId: string }>;
  /** Text files seeded into newly created column workspaces. */
  attachments?: RunAttachment[];
};

function metricsToTokenStats(m: PipelineMetrics): TokenStats {
  return {
    input_tokens: m.input_tokens,
    output_tokens: m.output_tokens,
    total_tokens: m.total_tokens,
    context_window: m.context_window,
    max_input_tokens: m.max_input_tokens,
    max_output_tokens: m.max_output_tokens,
    context_usage_pct: m.context_usage_pct,
    input_usage_pct: m.input_usage_pct,
  };
}

/** Strips events from a column's turn onward (keeps earlier completed turns) and clears this turn's derived state. */
function stripColumnFromTurn(col: ColumnState, turn: number): ColumnState {
  return {
    ...col,
    events: col.events.filter((e) => {
      const t = eventTurn(e);
      return t > 0 && t < turn;
    }),
    metrics: undefined,
    error: undefined,
    judge: undefined,
  };
}

/**
 * SSE streaming consumption hook — event flow in → column state updates.
 *
 * Responsibility boundaries:
 * - Receives ArenaEvents, merging them into columns by pipeline label
 * - Manages running / abort / error state
 * - file_diff only emits one workspaceRefreshToken counter signal (this hook's only
 *   cross-panel notification); when the file panel refreshes is up to the consumer
 *   (WorkspacePanel)
 * - Knows nothing about UI rendering or multi-turn history (composed upstream;
 *   history submission coordinates via the onSystemError callback)
 */
export function useArenaStream() {
  const t = useT();
  const [columns, setColumns] = useState<Record<string, ColumnState>>({});
  const [comparisonReport, setComparisonReport] = useState<ComparisonReportPayload | null>(null);
  const [workspaceRefreshToken, setWsRefreshToken] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Live ask_user batches keyed by agentId (label fallback): one per asking column,
   * so simultaneous columns each pop their own ask window. */
  const [pendingAsks, setPendingAsks] = useState<Record<string, PendingAskBatch>>({});
  const [askSubmitting, setAskSubmitting] = useState(false);
  /** Labels with an in-flight per-column stop request (spinner until the backend's terminal events land). */
  const [stoppingLabels, setStoppingLabels] = useState<Record<string, boolean>>({});
  const abortRef = useRef<AbortController | null>(null);
  /** Monotonic run sequence: stale stream teardowns (report tail) must not clobber a newer run's state. */
  const runSeqRef = useRef(0);
  /** Per-column turn currently running (1-based), used to strip/keep historical traces */
  const currentTurnsRef = useRef<Record<string, number>>({});
  /** Latest known agentId per pipeline label (carried on every column event; powers independent stop). */
  const agentIdByLabelRef = useRef<Record<string, string>>({});

  /** True when a column was user-stopped (backend stopped message), not a real failure. */
  const isStoppedMessage = (message?: string) =>
    typeof message === "string" && message.toLowerCase().includes("stopped by user");

  /** Merges an event into its column; system-level errors strip this turn and stop the run. */
  const applyEvent = useCallback((event: ArenaEvent) => {
    const label = event.pipeline;
    if (event.agentId && label) {
      agentIdByLabelRef.current[label] = event.agentId;
    }
    if (event.type === "report") {
      try {
        setComparisonReport(JSON.parse(event.content) as ComparisonReportPayload);
      } catch (error) {
        // Report parse failure does not block the main flow, but must leave a trace
        console.warn(`[arena] Comparison report parse failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    // Route/baseline-level error: strip this turn (keeping completed history turns); stop running
    if (event.type === "error" && (label === "system" || !label)) {
      setError(event.message || t("arena.stream.runError"));
      const turns = currentTurnsRef.current;
      setColumns((prev) => {
        const next: Record<string, ColumnState> = {};
        for (const [key, col] of Object.entries(prev)) {
          next[key] = stripColumnFromTurn(col, turns[key] ?? 1);
        }
        return next;
      });
      setRunning(false);
      return;
    }
    if (event.type === "file_diff") {
      // Side effect outside the setColumns updater: the updater must stay pure (StrictMode double-invokes it)
      setWsRefreshToken((n) => n + 1);
    }
    // ask_user pops a per-column question window; the following observation (answer
    // delivered, skipped, or channel timeout) removes that column's batch. Sibling
    // columns' observations must not dismiss someone else's pending batch.
    if (event.type === "action" && event.tool?.toLowerCase() === "ask_user") {
      const questions = askQuestionsOfArgs(event.args);
      if (questions.length > 0) {
        const key = event.agentId !== undefined && event.agentId !== "" ? event.agentId : label;
        setPendingAsks((prev) => ({
          ...prev,
          [key]: { sourceLabel: label, agentId: event.agentId, questions },
        }));
      }
    } else if (event.type === "observation" || event.type === "complete" || event.type === "error") {
      // Clear by both identities the column may be keyed under; a no-op delete keeps
      // other columns' batches untouched.
      const keys = [event.agentId, label].filter((key): key is string => key !== undefined && key !== "");
      setPendingAsks((prev) => {
        const hits = keys.filter((key) => prev[key] !== undefined);
        if (hits.length === 0) return prev;
        const next = { ...prev };
        for (const key of hits) delete next[key];
        return next;
      });
    }
    if (event.type === "complete" || event.type === "error") {
      // A settled column is no longer "stopping": the backend's terminal events have landed.
      setStoppingLabels((prev) => {
        if (prev[label] === undefined) return prev;
        const next = { ...prev };
        delete next[label];
        return next;
      });
    }
    setColumns((prev) => {
      const col = prev[label] ?? { label, events: [] };
      const next = { ...col };

      if (event.type === "token_update") {
        next.tokenStats = { ...event.token_stats };
        if (event.workspace) next.workspace = event.workspace;
      } else if (event.type === "complete") {
        if (event.metrics) {
          next.metrics = event.metrics;
          next.tokenStats = event.token_stats
            ? { ...event.token_stats }
            : metricsToTokenStats(event.metrics);
        }
        if (event.workspace) next.workspace = event.workspace;
        // complete events are not appended to the events list (avoids TraceView rendering an empty segment)
      } else if (event.type === "error") {
        next.error = event.message || t("arena.stream.runError");
        next.events = [...col.events, event];
      } else {
        next.events = [...col.events, event];
      }

      return { ...prev, [label]: next };
    });
  }, [t]);

  /** User stop: cancel the request and strip this turn (same strip semantics as run / applyEvent). */
  const cancelRun = useCallback(() => {
    const ac = abortRef.current;
    if (ac && !ac.signal.aborted) {
      ac.abort();
    }
    setPendingAsks({});
    setStoppingLabels({});
    agentIdByLabelRef.current = {};
    // Columns are stripped below; a previous settled run's report would otherwise linger beside them.
    setComparisonReport(null);
    const turns = currentTurnsRef.current;
    setColumns((prev) => {
      const next: Record<string, ColumnState> = {};
      for (const [key, col] of Object.entries(prev)) {
        next[key] = stripColumnFromTurn(col, turns[key] ?? 1);
      }
      return next;
    });
    setRunning(false);
  }, []);

  /**
   * Independently stops one column (other columns keep streaming).
   * No optimistic strip: the backend emits stopped error + failed complete,
   * which settle the column through the normal applyEvent path.
   */
  const stopColumn = useCallback(
    async (label: string): Promise<boolean> => {
      const agentId = agentIdByLabelRef.current[label];
      if (!agentId) return false;
      setStoppingLabels((prev) => ({ ...prev, [label]: true }));
      try {
        await stopArenaColumn(agentId);
        return true;
      } catch (error) {
        // Already settled (404) still resolves via the terminal events already received; anything else surfaces.
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("404") && !message.toLowerCase().includes("no live column")) {
          setError(message);
        }
        setStoppingLabels((prev) => {
          if (prev[label] === undefined) return prev;
          const next = { ...prev };
          delete next[label];
          return next;
        });
        return false;
      }
    },
    [setError],
  );

  /**
   * Starts one Arena run (including this turn's strip).
   *
   * @param opts  run parameters
   * @param onSystemError invoked when a route/baseline-level error event arrives (upstream clears pending history submission)
   * @returns the run result for the upstream to decide on history submission
   */
  const run = useCallback(
    async (opts: RunOptions, onSystemError?: () => void): Promise<RunResult> => {
      const { question, dimension, selections, baseline, columnSessions, preserveColumns, attachments } = opts;
      setError(null);
      setRunning(true);
      setComparisonReport(null);
      setPendingAsks({});
      setStoppingLabels({});
      agentIdByLabelRef.current = {};
      const turns: Record<string, number> = {};
      for (const column of preserveColumns) {
        turns[column.label] = deriveTurn(columnSessions[column.label]?.messages ?? []);
      }
      currentTurnsRef.current = turns;

      // Multi-turn: keep earlier turns; strip this turn and later (including failed-retry residue)
      setColumns((prev) => {
        const next: Record<string, ColumnState> = {};
        for (const column of preserveColumns) {
          const old = prev[column.label];
          const turn = turns[column.label] ?? 1;
          const workspace = columnSessions[column.label]?.workspace ?? old?.workspace;
          next[column.label] = old
            ? { ...stripColumnFromTurn(old, turn), frameworkId: column.frameworkId, workspace }
            : { label: column.label, frameworkId: column.frameworkId, events: [], workspace };
        }
        return next;
      });

      // A previous stream may still be open on its report tail; close it so two
      // streams never write column state concurrently.
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      const signal = abortRef.current.signal;
      const seq = ++runSeqRef.current;
      /** Columns expected to settle this run; running ends when all have (the report tail may lag). */
      const expectedLabels = new Set(preserveColumns.map((c) => c.label));
      const settledLabels = new Set<string>();
      const markSettled = (event: ArenaEvent) => {
        if (event.type !== "complete") return;
        if (!event.pipeline) return;
        settledLabels.add(event.pipeline);
        if (
          expectedLabels.size > 0 &&
          settledLabels.size >= expectedLabels.size &&
          [...expectedLabels].every((label) => settledLabels.has(label)) &&
          runSeqRef.current === seq
        ) {
          // All columns settled: the run is over for the user even though the stream
          // stays open briefly while the backend publishes its report tail.
          setRunning(false);
        }
      };
      try {
        await streamArenaRun({
          question,
          dimension,
          onEvent: (event) => {
            if (
              event.type === "error" &&
              (event.pipeline === "system" || !event.pipeline)
            ) {
              onSystemError?.();
              // Proactively disconnect SSE after a system-level error so an abnormal backend never leaves in-flight requests lingering
              abortRef.current?.abort();
            }
            markSettled(event);
            applyEvent(event);
          },
          signal,
          selections,
          baseline,
          // Malformed SSE events must not be dropped silently: leave a trace to catch missing Trace segments
          onParseError: (raw, err) =>
            console.warn(`[arena] SSE event parse failed: ${err.message} raw=${raw.slice(0, 120)}`),
          columnSessions,
          attachments,
        });
        return { aborted: false, failed: false };
      } catch (err) {
        if (isAbortError(err) || signal.aborted) {
          // User-initiated cancellation: not a failure; upstream clears pending and stops accordingly
          return { aborted: true, failed: false };
        }
        console.error(err);
        setError(err instanceof Error ? err.message : String(err));
        return { aborted: false, failed: true };
      } finally {
        // Sequence guard: a superseded stream's teardown must not flip a newer run's state
        if (runSeqRef.current === seq) {
          setPendingAsks({});
          setRunning(false);
        }
      }
    },
    [applyEvent],
  );

  /** Clears columns and errors (dimension switch / new conversation). */
  const resetColumns = useCallback(() => {
    setColumns({});
    setComparisonReport(null);
    setError(null);
    setStoppingLabels({});
    agentIdByLabelRef.current = {};
  }, []);

  /** Auto-judge result writeback: the only external write entry into column state (no raw setter is exported). */
  const applyJudgeResults = useCallback((results: Record<string, JudgeResult>) => {
    setColumns((prev) => {
      const next: Record<string, ColumnState> = {};
      for (const [label, col] of Object.entries(prev)) {
        next[label] = results[label] ? { ...col, judge: results[label] } : col;
      }
      return next;
    });
  }, []);

  /** Only aborts in-flight requests without updating any state (used for unmount cleanup). */
  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /** Delivers the human's answer to one column's pending ask_user batch (returns acceptance). */
  const answerAsk = useCallback(
    async (agentId: string, questionId: string, answer: string): Promise<boolean> => {
      if (agentId === "") return false;
      setAskSubmitting(true);
      try {
        await answerArenaQuestion(agentId, questionId, answer);
        return true;
      } catch {
        setError(t("common.askSubmitError"));
        return false;
      } finally {
        setAskSubmitting(false);
      }
    },
    [t],
  );

  /** Manual dismissal of one column's batch (X button): the pending batch stays
   * server-side until timeout or answer. */
  const clearPendingAsk = useCallback((agentId: string) => {
    setPendingAsks((prev) => {
      if (prev[agentId] === undefined) return prev;
      const next = { ...prev };
      delete next[agentId];
      return next;
    });
  }, []);

  return {
    columns,
    comparisonReport,
    workspaceRefreshToken,
    running,
    error,
    setError,
    run,
    cancelRun,
    stopColumn,
    stoppingLabels,
    isStoppedMessage,
    resetColumns,
    applyJudgeResults,
    stop,
    pendingAsks,
    askSubmitting,
    answerAsk,
    clearPendingAsk,
  };
}
