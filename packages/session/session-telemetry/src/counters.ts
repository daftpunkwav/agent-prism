/**
 * @file session-telemetry/counters
 * @description In-memory session lifecycle counters with durations.
 *
 * Responsibilities:
 * - Count session starts, terminal transitions, and milestone entries
 * - Track per-kind active gauges and completed-run durations
 * - Keep every observation idempotent-safe (double-finish counts once)
 *
 * Telemetry observes the ledger; it never decides lifecycle. Counters feed
 * dashboards and the sessions statistics bar; the SessionStore remains the
 * source of truth for state. All time arrives injected (no ambient clock).
 */

import type { SessionKind, SessionStatus } from "@agentprism/contracts";

/** Terminal statuses (transitions counted once per session). */
const TERMINAL: SessionStatus[] = ["completed", "failed", "cancelled"];

/**
 * How many settled ids stay remembered for duplicate-transition suppression. The
 * ledger id space grows for the life of the process, so an unbounded set would leak;
 * past this window a duplicate settle counts again (best effort, one extra count).
 */
const SETTLED_HISTORY_CAP = 20_000;

/** Per-kind counters. */
export interface KindCounters {
  started: number;
  completed: number;
  failed: number;
  cancelled: number;
  entries: number;
  /** Sum of completed-run durations in ms (for means). */
  completedDurationMs: number;
  /** How many completed runs contributed a duration (mean denominator). */
  completedDurationSamples: number;
  /** Slowest completed run in ms (0 when none). */
  maxDurationMs: number;
}

/** Zeroed counters for one kind. */
function zeroKind(): KindCounters {
  return { started: 0, completed: 0, failed: 0, cancelled: 0, entries: 0, completedDurationMs: 0, completedDurationSamples: 0, maxDurationMs: 0 };
}

/** In-memory session telemetry sink. */
export class SessionTelemetry {
  private readonly kinds = new Map<SessionKind, KindCounters>();
  /** Settled ids with their kind (bounded FIFO: see SETTLED_HISTORY_CAP). */
  private readonly settled = new Map<string, SessionKind>();
  private readonly settledOrder: string[] = [];
  /** Open sessions only: their entries leave on settle, so this map cannot grow with history. */
  private readonly starts = new Map<string, { kind: SessionKind; at: number }>();

  private counters(kind: SessionKind): KindCounters {
    let found = this.kinds.get(kind);
    if (found === undefined) {
      found = zeroKind();
      this.kinds.set(kind, found);
    }
    return found;
  }

  /** Records a session start (repeat starts for one id count once). */
  started(id: string, kind: SessionKind, at: number): void {
    if (this.starts.has(id)) return;
    this.starts.set(id, { kind, at });
    this.counters(kind).started += 1;
  }

  /**
   * Records a terminal transition (first transition wins: a completed run
   * later failing counts completed, never failed).
   */
  settledTransition(id: string, status: SessionStatus, at: number): void {
    if (!TERMINAL.includes(status) || this.settled.has(id)) return;
    const start = this.starts.get(id);
    // `settled.has(id)` above already returned for a known id, so the start entry is
    // the only source of the kind; an orphan settle falls back to the generic kind.
    const kind = start?.kind ?? "agent";
    // Remember the id (for duplicate suppression and later kind lookups) and close the
    // open gauge by dropping the start entry the duration came from.
    this.rememberSettled(id, kind);
    if (start !== undefined) this.starts.delete(id);
    const counters = this.counters(kind);
    counters[status === "completed" ? "completed" : status === "failed" ? "failed" : "cancelled"] += 1;
    if (status === "completed" && start !== undefined && Number.isFinite(at) && at >= start.at) {
      const duration = at - start.at;
      counters.completedDurationMs += duration;
      counters.completedDurationSamples += 1;
      counters.maxDurationMs = Math.max(counters.maxDurationMs, duration);
    }
  }

  /** Records milestone entries for a session (count only, kinds merge). */
  entries(id: string, count: number): void {
    if (!Number.isFinite(count) || count <= 0) return;
    // Settled ids still know their kind, so late milestones stay attributed.
    const kind = this.starts.get(id)?.kind ?? this.settled.get(id) ?? "agent";
    this.counters(kind).entries += Math.floor(count);
  }

  /** Snapshot of per-kind counters (zero-filled for unseen kinds). */
  snapshot(): Record<SessionKind, KindCounters> {
    return {
      arena: { ...this.counters("arena") },
      agent: { ...this.counters("agent") },
      builder: { ...this.counters("builder") },
    };
  }

  /** Mean completed-run duration in ms per kind (0 when none completed). */
  meanDurationMs(kind: SessionKind): number {
    const counters = this.counters(kind);
    // Divide by the runs that actually reported a duration, not by every completion.
    return counters.completedDurationSamples === 0 ? 0 : counters.completedDurationMs / counters.completedDurationSamples;
  }

  /** Currently open (started but unsettled) session count. */
  openSessions(): number {
    // `starts` holds open sessions only (settles remove their entry), so the gauge
    // cannot go negative for a settle whose start this sink never observed.
    return this.starts.size;
  }

  /** Remembers one settled id, evicting the oldest beyond the dedupe window. */
  private rememberSettled(id: string, kind: SessionKind): void {
    this.settled.set(id, kind);
    this.settledOrder.push(id);
    while (this.settledOrder.length > SETTLED_HISTORY_CAP) {
      const oldest = this.settledOrder.shift();
      if (oldest !== undefined && oldest !== id) this.settled.delete(oldest);
    }
  }
}
