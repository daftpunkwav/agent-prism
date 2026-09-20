/**
 * @file useColumnLogs
 * @description Polling hook for one arena column's observability logs.
 *
 * Responsibilities:
 * - Poll the column-logs endpoint for one workspace/label pair on an interval
 * - Keep the last snapshot on refresh failure so polling never surfaces errors mid-run
 *
 * intervalMs 0 means fetch once; cleanup clears the pending timer on unmount.
 */

"use client";

import { useEffect, useState } from "react";
import { fetchColumnLogs } from "@agentprism/client";
import type { ColumnLogs } from "@agentprism/client";

/** Polling hook for one column's logs; intervalMs 0 means fetch once. */
export function useColumnLogs(workspace: string | undefined, label: string, intervalMs: number): ColumnLogs | null {
  const [logs, setLogs] = useState<ColumnLogs | null>(null);
  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async (): Promise<void> => {
      try {
        const next = await fetchColumnLogs(workspace, label);
        if (!cancelled) setLogs(next);
      } catch {
        // Polling view: a failed refresh keeps the last snapshot; the next tick retries.
      }
      if (!cancelled && intervalMs > 0) timer = setTimeout(() => void tick(), intervalMs);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [workspace, label, intervalMs]);
  return logs;
}
