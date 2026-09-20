/**
 * @file trace-log
 * @description Trace-entry factory for one builder session.
 *
 * Responsibilities:
 * - Assign monotonic per-session sequence numbers, ids, and timestamps
 * - Forward every entry, uncut, to the injected persistence hook
 *
 * The log itself retains nothing: disk persistence (the session trace journal)
 * owns retention, and the live SSE stream delivers entries as they are created.
 * Payloads are never capped here — full-fidelity observability is a product
 * decision (see the wire tracer); a persistence failure is the hook's own
 * concern and must never break the turn producing the entry.
 */

import type { BuilderTraceEntry, BuilderTraceKind, Clock, IdGenerator } from "@agentprism/contracts";

export interface TraceLogOptions {
  idGenerator: IdGenerator;
  clock: Clock;
  /** Receives every appended entry uncut (journal persistence); call failures propagate to the caller. */
  onAppend?: (entry: BuilderTraceEntry) => void;
}

/** Options for one append. */
export interface TraceAppendOptions {
  turn?: number;
  durationMs?: number | null;
}

/** Trace-entry factory: append-only, monotonic seq, no in-memory retention. */
export class TraceLog {
  private seq = 0;

  constructor(private readonly options: TraceLogOptions) {}

  /**
   * Creates one entry and hands it to the persistence hook uncut.
   * @returns The entry (for immediate stream delivery; nothing is retained).
   */
  append(
    kind: BuilderTraceKind,
    title: string,
    data: Record<string, unknown>,
    options: TraceAppendOptions = {},
  ): BuilderTraceEntry {
    const entry: BuilderTraceEntry = {
      id: this.options.idGenerator.next(),
      seq: this.seq++,
      ts: this.options.clock.now(),
      turn: options.turn ?? 0,
      kind,
      title,
      data,
      durationMs: options.durationMs ?? null,
    };
    this.options.onAppend?.(entry);
    return entry;
  }
}
