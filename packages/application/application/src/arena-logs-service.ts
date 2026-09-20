/**
 * @file arena-logs-service
 * @description Read side of the per-run column observability logs (events + LLM wire).
 *
 * Responsibilities:
 * - Resolve the run log directory from a resident workspace (workspace → runId → _traces)
 * - Parse the JSONL log pair back into typed entries with tail caps
 * - Report not-found as an empty result (polling clients re-poll; no error churn)
 *
 * The write side lives in arena-runner (RunTraceLogs); on-disk names and the
 * read-view shape converge on contracts/run-logs so the two sides can never drift.
 */

import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import {
  eventLogFileName,
  wireLogFileName,
  type ArenaEvent,
  type ColumnLogs,
  type WireLogEntry,
} from "@agentprism/contracts";
import type { WorkspaceRegistry } from "@agentprism/runtime";

export interface ArenaLogsServiceDeps {
  workspaceRegistry: WorkspaceRegistry;
}

/** Tail caps: the comparison page reads live tails, not full history. */
const MAX_EVENTS = 4_000;
const MAX_WIRE = 400;

/** First byte window probed for a tail read; widened on demand when rows are larger. */
const TAIL_PROBE_BYTES = 4 * 1024 * 1024;
/** Safety margin applied to the observed rows-per-byte density when widening the window. */
const TAIL_WINDOW_MARGIN = 1.2;
/** Window probes before giving up on density sampling and doing an exact whole-file read. */
const MAX_TAIL_PROBES = 4;

/** Empty result for a workspace/log pair that has nothing on disk yet. */
function emptyLogs(workspace: string, label: string): ColumnLogs {
  return { workspace, label, events: [], wire: [], truncated: false };
}

/** Parsed tail of one byte window plus the physical line count the cap applies to. */
interface TailWindow<T> {
  rows: T[];
  /** Physical lines in the window (blank and torn lines included), after boundary alignment. */
  count: number;
  truncated: boolean;
}

/**
 * Parses the `[start, size)` byte range as JSONL and returns its tail under `cap`.
 * When `start > 0` the first split element is a row cut by the window boundary
 * and is dropped; that cut also proves at least one row exists before the
 * window, so any windowed return reports truncated.
 */
function parseTailWindow<T>(fd: number, start: number, size: number, cap: number): TailWindow<T> {
  const bytes = Buffer.allocUnsafe(size - start);
  let filled = 0;
  while (filled < bytes.length) {
    const read = readSync(fd, bytes, filled, bytes.length - filled, start + filled);
    if (read <= 0) break;
    filled += read;
  }
  const lines = bytes.toString("utf-8", 0, filled).split("\n");
  // A well-formed JSONL file ends with a newline, so split yields one trailing
  // empty element; it is not a row and must not count toward the cap window.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (start > 0) lines.shift();
  const truncated = start > 0 || lines.length > cap;
  const rows: T[] = [];
  for (const line of truncated ? lines.slice(-cap) : lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      rows.push(JSON.parse(trimmed) as T);
    } catch {
      // A torn tail line (crash mid-append) must not poison the rest.
    }
  }
  return { rows, count: lines.length, truncated };
}

/**
 * Reads a JSONL file and returns the parsed tail; missing/invalid lines are skipped.
 *
 * Run logs grow into the tens of MB and the logs page polls every two seconds,
 * so the file is not decoded whole: reads start from a byte window at the end
 * and widen using the observed rows-per-byte density until `cap` physical lines
 * are covered or the file start is reached. The result is identical to a
 * whole-file parse (tail caps, truncated flag, torn-line tolerance); the final
 * whole-file probe guarantees exactness when density sampling cannot converge.
 */
function readJsonlTail<T>(file: string, cap: number): { rows: T[]; truncated: boolean } {
  if (!existsSync(file)) return { rows: [], truncated: false };
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch {
    // A concurrent append can race a read on Windows; treat as "nothing new yet".
    return { rows: [], truncated: false };
  }
  try {
    const size = fstatSync(fd).size;
    if (size === 0) return { rows: [], truncated: false };
    let window = Math.min(size, TAIL_PROBE_BYTES);
    for (let probe = 0; probe < MAX_TAIL_PROBES; probe += 1) {
      const start = size - window;
      const parsed = parseTailWindow<T>(fd, start, size, cap);
      if (start === 0 || parsed.count >= cap) return { rows: parsed.rows, truncated: parsed.truncated };
      // Widen so the next probe covers the whole cap even if rows get bigger.
      const density = parsed.count > 0 ? window / parsed.count : 0;
      const needed = density > 0 ? Math.ceil(cap * TAIL_WINDOW_MARGIN * density) : window * 8;
      window = Math.min(size, Math.max(window * 2, needed));
    }
    return parseTailWindow<T>(fd, 0, size, cap);
  } finally {
    closeSync(fd);
  }
}

/** Read side of the per-run column logs (events + LLM wire). */
export class ArenaLogsService {
  private readonly deps: ArenaLogsServiceDeps;

  constructor(deps: ArenaLogsServiceDeps) {
    this.deps = deps;
  }

  /**
   * Reads one column's logs for the run that owns the given (resident) workspace.
   * Unknown workspaces yield an empty result rather than 404: the logs page polls
   * while columns are still starting and their workspace is not registered yet.
   */
  columnLogs(workspaceName: string, label: string): ColumnLogs {
    const runId = this.deps.workspaceRegistry.runIdOf(workspaceName);
    if (runId === null) return emptyLogs(workspaceName, label);
    let traceDir: string;
    try {
      traceDir = this.deps.workspaceRegistry.traceDir(runId);
    } catch {
      return emptyLogs(workspaceName, label);
    }
    const events = readJsonlTail<ArenaEvent>(join(traceDir, eventLogFileName(label)), MAX_EVENTS);
    const wire = readJsonlTail<WireLogEntry>(join(traceDir, wireLogFileName(label)), MAX_WIRE);
    return {
      workspace: workspaceName,
      label,
      events: events.rows,
      wire: wire.rows,
      truncated: events.truncated || wire.truncated,
    };
  }
}
