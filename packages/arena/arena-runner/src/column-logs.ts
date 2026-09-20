/**
 * @file column-logs
 * @description Per-run on-disk observability logs: the raw event stream and captured
 * LLM wire records, appended as JSONL beside the run's workspaces.
 *
 * Responsibilities:
 * - Append every column event to `<traceDir>/<stem>.events.jsonl`
 * - Append every captured wire record to `<traceDir>/<stem>.wire.jsonl`
 * - Fail open: append failures degrade to a single warning, never break the run
 *
 * Pure append-only sinks: readers (route layer) parse the same files back.
 */

import { mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import {
  eventLogFileName,
  wireLogFileName,
  type ArenaEvent,
  type LlmWireRecord,
  type WireLogEntry,
} from "@agentprism/contracts";

/** Append-only JSONL log pair (events + wire) for one run. */
export class RunTraceLogs {
  private readonly dir: string;
  private readonly now: () => number;
  private wireSeq = 0;
  private warned = false;
  private readonly inflight = new Set<Promise<void>>();
  /** Lines queued for one file while its previous batched write is still in flight. */
  private readonly pending = new Map<string, { lines: string[] }>();
  /** Per-file write chain: fs thread-pool operations give no cross-call ordering guarantee. */
  private readonly chains = new Map<string, Promise<void>>();

  constructor(traceDir: string, now: () => number) {
    this.dir = traceDir;
    this.now = now;
    mkdirSync(traceDir, { recursive: true });
  }

  /**
   * Resolves when every queued append has settled (settled = written or
   * swallowed by the fail-open catch). Appends queued during the wait are
   * awaited too, so callers can loop until quiescent. Producers never call
   * this; it exists for graceful shutdown and tests.
   */
  async flush(): Promise<void> {
    while (this.inflight.size > 0) {
      await Promise.all([...this.inflight]);
    }
  }

  /** Appends one run event to the column's event log (fire-and-forget). */
  appendEvent(label: string, event: ArenaEvent): void {
    this.append(eventLogFileName(label), JSON.stringify(event));
  }

  /** Appends one captured wire record to the column's wire log (fire-and-forget). */
  appendWire(label: string, turn: number, record: LlmWireRecord): void {
    const entry: WireLogEntry = { seq: this.wireSeq++, ts: this.now(), turn, record };
    this.append(wireLogFileName(label), JSON.stringify(entry));
  }

  /** Absolute path of the column's wire log (shared contracts file name; may not exist yet). */
  wireLogPath(label: string): string {
    return join(this.dir, wireLogFileName(label));
  }

  /** Absolute path of the column's event log (shared contracts file name; may not exist yet). */
  eventLogPath(label: string): string {
    return join(this.dir, eventLogFileName(label));
  }

  /**
   * Appends one line without ever blocking or failing the producer: a sick disk
   * must not break the run it observes. Only the first failure warns, so a full
   * disk cannot flood the log with warnings either.
   *
   * Per-file ordering and burst cost: fs.promises operations run on the shared
   * thread pool with no cross-call ordering guarantee, so same-file appends are
   * chained onto the previous write, and lines queued while that write is in
   * flight are coalesced into one batched appendFile (submission order kept, a
   * burst costs one syscall per drain instead of one per line).
   */
  private append(file: string, line: string): void {
    const batch = this.pending.get(file);
    if (batch !== undefined) {
      batch.lines.push(line);
      return;
    }
    const entry = { lines: [line] };
    this.pending.set(file, entry);
    const write = (this.chains.get(file) ?? Promise.resolve())
      .then(() => {
        // Everything appended synchronously up to this point rides in one write;
        // later appends open the next chain link.
        this.pending.delete(file);
        return appendFile(join(this.dir, file), entry.lines.map((l) => `${l}\n`).join(""), "utf-8");
      })
      .catch((error: unknown) => {
        if (this.warned) return;
        this.warned = true;
        console.warn(
          `[arena-runner] run log append failed (further warnings suppressed): ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    this.chains.set(file, write);
    this.inflight.add(write);
    void write.finally(() => {
      this.inflight.delete(write);
      // Drop the chain slot once this settled write is still the tail, so the
      // maps never grow with retired files (a newer append has re-pointed them).
      if (this.chains.get(file) === write) this.chains.delete(file);
    });
  }
}
