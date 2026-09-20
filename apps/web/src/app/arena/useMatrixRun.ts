/**
 * @file useMatrixRun
 * @description Matrix run orchestration hook: progress in, report out.
 *
 * Responsibilities:
 * - Load scored templates and stream one matrix run with abort support
 * - Hold per-cell progress plus the final report for the panel
 */

"use client";

import { useCallback, useRef, useState } from "react";
import {
  fetchTemplates,
  isAbortError,
  streamMatrixRun,
  type MatrixStreamItem,
} from "@agentprism/client";

export type MatrixCellProgress = {
  templateId: string;
  status: string;
  score: string;
  error: string;
};

export type MatrixCellResultView = {
  template_id: string;
  dimension: string;
  selections: string[];
  score: { passed: number; total: number };
  columns: Record<string, boolean>;
  metrics?: { total_tokens: number; tool_calls: number; steps: number } | null;
};

export function useMatrixRun(setError: (message: string) => void) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<MatrixCellProgress[]>([]);
  const [cells, setCells] = useState<MatrixCellResultView[]>([]);
  const [elapsedSecs, setElapsedSecs] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const start = useCallback(async () => {
    if (abortRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setProgress([]);
    setCells([]);
    setElapsedSecs(null);
    const startedAt = Date.now();
    try {
      const templates = await fetchTemplates({ signal: controller.signal });
      const scored = templates.filter((t) => t.category === "scored");
      if (scored.length === 0) {
        setError("No scored templates available");
        return;
      }
      await streamMatrixRun({
        cells: scored.map((t) => ({ template_id: t.id })),
        signal: controller.signal,
        onItem: (item: MatrixStreamItem) => {
          if (item.type === "matrix_progress" && item.template_id) {
            setProgress((prev) => {
              const next = prev.filter((p) => p.templateId !== item.template_id);
              return [...next, { templateId: item.template_id as string, status: item.status ?? "", score: item.score ?? "", error: item.error ?? "" }];
            });
          } else if (item.type === "matrix_report" && item.report && typeof item.report === "object") {
            const report = item.report as { cells?: MatrixCellResultView[] };
            setCells(Array.isArray(report.cells) ? report.cells : []);
          }
        },
      });
    } catch (error) {
      if (!isAbortError(error) && !controller.signal.aborted) {
        setError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setElapsedSecs(Math.round((Date.now() - startedAt) / 1000));
      setRunning(false);
      abortRef.current = null;
    }
  }, [setError]);

  return { running, progress, cells, elapsedSecs, start, stop };
}
