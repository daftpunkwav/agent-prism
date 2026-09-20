/**
 * @file trace-store
 * @description Per-session observability journal (JSONL) for the builder.
 *
 * Responsibilities:
 * - Append trace records (entries / events / turn markers) to one journal file
 *   per session, coalescing bursts through a debounced flush
 * - Read a session's full journal back (flushing pending lines first, so a
 *   read never misses what append accepted)
 * - Clear the journal with its session
 *
 * Persistence is fail-open: disk failures degrade to warnings, never break the
 * turn producing the records. A malformed line (crash mid-append) is skipped
 * loudly — journal reads never fabricate records.
 */

import type { AppendFile } from "@agentprism/persistence";
import type { BuilderTraceRecord } from "@agentprism/contracts";

/** Debounce window coalescing record bursts (deltas arrive faster than disks). */
const FLUSH_DEBOUNCE_MS = 300;

export interface SessionTraceStoreDeps {
  /** Opens (or creates) the append-only journal for one session. */
  open: (sessionId: string) => AppendFile;
  /** Write-coalescing window in ms (default 300). */
  flushDebounceMs?: number;
}

export class SessionTraceStore {
  private readonly deps: SessionTraceStoreDeps;
  private readonly flushDebounceMs: number;
  /** Pending lines per session (accepted but not yet on disk). */
  private readonly pending = new Map<string, string[]>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(deps: SessionTraceStoreDeps) {
    this.deps = deps;
    this.flushDebounceMs = deps.flushDebounceMs ?? FLUSH_DEBOUNCE_MS;
  }

  /** Accepts one record (serialized immediately; disk write is debounced). */
  append(sessionId: string, record: BuilderTraceRecord): void {
    let line: string;
    try {
      line = JSON.stringify(record);
    } catch {
      // A record that cannot serialize (cycle/BigInt) would corrupt the journal:
      // drop it loudly rather than break the turn producing it.
      console.warn(`[builder-trace] record not serializable, dropped (session ${sessionId})`);
      return;
    }
    const queue = this.pending.get(sessionId) ?? [];
    queue.push(line);
    this.pending.set(sessionId, queue);
    this.scheduleFlush(sessionId);
  }

  /** Flushes pending lines, then returns every record of the session (oldest first). */
  async read(sessionId: string): Promise<BuilderTraceRecord[]> {
    await this.flush(sessionId);
    const lines = await this.deps.open(sessionId).readLines();
    const records: BuilderTraceRecord[] = [];
    let dropped = 0;
    for (const line of lines) {
      try {
        records.push(JSON.parse(line) as BuilderTraceRecord);
      } catch {
        dropped += 1;
      }
    }
    if (dropped > 0) {
      console.warn(`[builder-trace] journal for ${sessionId} had ${dropped} unreadable line(s), skipped`);
    }
    return records;
  }

  /** Awaits the pending flush of one session (turn-end durability). */
  async flush(sessionId: string): Promise<void> {
    const timer = this.timers.get(sessionId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(sessionId);
    }
    await this.writePending(sessionId);
  }

  /** Awaits every pending flush (shutdown durability). */
  async flushAll(): Promise<void> {
    for (const sessionId of [...this.pending.keys()]) {
      await this.flush(sessionId);
    }
  }

  /** Clears the journal alongside its session (kept as an empty file: the port has no unlink). */
  async delete(sessionId: string): Promise<void> {
    const timer = this.timers.get(sessionId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(sessionId);
    }
    this.pending.delete(sessionId);
    await this.deps.open(sessionId).rewrite([]);
  }

  private scheduleFlush(sessionId: string): void {
    if (this.timers.has(sessionId)) return;
    const timer = setTimeout(() => {
      this.timers.delete(sessionId);
      void this.writePending(sessionId);
    }, this.flushDebounceMs);
    timer.unref?.();
    this.timers.set(sessionId, timer);
  }

  private async writePending(sessionId: string): Promise<void> {
    const queue = this.pending.get(sessionId);
    if (queue === undefined || queue.length === 0) return;
    this.pending.set(sessionId, []);
    try {
      await this.deps.open(sessionId).append(queue);
    } catch (error) {
      // In-memory SSE state stays authoritative for live views; disk loss is logged.
      console.warn(`[builder-trace] journal flush failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
