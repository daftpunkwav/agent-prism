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

/** Per-kind counters. */
export interface KindCounters {
  started: number;
  completed: number;
  failed: number;
  cancelled: number;
  entries: number;
  /** Sum of completed-run durations in ms (for means). */
  completedDurationMs: number;
  /** Slowest completed run in ms (0 when none). */
  maxDurationMs: number;
}

/** Zeroed counters for one kind. */
function zeroKind(): KindCounters {
  return { started: 0, completed: 0, failed: 0, cancelled: 0, entries: 0, completedDurationMs: 0, maxDurationMs: 0 };
}

/** In-memory session telemetry sink. */
export class SessionTelemetry {
  private readonly kinds = new Map<SessionKind, KindCounters>();
  private readonly settled = new Set<string>();
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
    const kind = start?.kind ?? "agent";
    this.settled.add(id);
    const counters = this.counters(kind);
    counters[status === "completed" ? "completed" : status === "failed" ? "failed" : "cancelled"] += 1;
    if (status === "completed" && start !== undefined && Number.isFinite(at) && at >= start.at) {
      const duration = at - start.at;
      counters.completedDurationMs += duration;
      counters.maxDurationMs = Math.max(counters.maxDurationMs, duration);
    }
  }

  /** Records milestone entries for a session (count only, kinds merge). */
  entries(id: string, count: number): void {
    if (!Number.isFinite(count) || count <= 0) return;
    const kind = this.starts.get(id)?.kind ?? "agent";
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
    return counters.completed === 0 ? 0 : counters.completedDurationMs / counters.completed;
  }

  /** Currently open (started but unsettled) session count. */
  openSessions(): number {
    return this.starts.size - this.settled.size;
  }
}
