/**
 * @file run-logs
 * @description Contract of the per-run column observability logs (events + LLM wire).
 *
 * Responsibilities:
 * - Define the JSONL envelope (WireLogEntry) and the tailed read view (ColumnLogs)
 * - Single-source the on-disk log file names so writers and readers never drift
 *
 * The write side lives in arena-runner (RunTraceLogs), the read side in the
 * application layer (ArenaLogsService) and the browser client; all three bind
 * the names and shapes here.
 */

import type { ArenaEvent } from "./events.js";
import type { LlmWireRecord } from "./builder.js";
import { safeLogStem } from "./workspace-name.js";

/**
 * One JSONL row of the per-column LLM wire log: the captured LlmWireRecord plus
 * the run-local envelope (seq is the append order within the whole run, ts the
 * capture time, turn the column's 1-based LLM turn).
 */
export interface WireLogEntry {
  seq: number;
  ts: number;
  turn: number;
  record: LlmWireRecord;
}

/** Tailed view of one column's run logs, as served by GET /api/arena/column-logs. */
export interface ColumnLogs {
  workspace: string;
  label: string;
  /** Raw run events in arrival order (tail-capped). */
  events: ArenaEvent[];
  /** Captured LLM wire records in call order (tail-capped). */
  wire: WireLogEntry[];
  /** True when either file exceeded its cap and rows were dropped from the head. */
  truncated: boolean;
}

/** On-disk name of a column's raw event log (shared by writer and reader). */
export function eventLogFileName(label: string): string {
  return `${safeLogStem(label)}.events.jsonl`;
}

/** On-disk name of a column's LLM wire log (shared by writer and reader). */
export function wireLogFileName(label: string): string {
  return `${safeLogStem(label)}.wire.jsonl`;
}
