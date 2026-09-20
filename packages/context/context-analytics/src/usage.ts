/**
 * @file context-analytics/usage
 * @description Per-turn token accounting across context sources.
 *
 * Responsibilities:
 * - Record per-turn per-source token usage (prompt input side)
 * - Aggregate totals, peaks, and per-source shares across turns
 *
 * Accounting is measured, not estimated, at the record call: the host passes
 * observed token counts (from the tracker or the provider usage payload).
 * Records are append-only; aggregations derive deterministically.
 */

export type UsageSource =
  | "system"
  | "instructions"
  | "history"
  | "tools"
  | "retrieval"
  | "mentions"
  | "skills"
  | "compaction";

/** One recorded turn of context consumption. */
export interface TurnUsage {
  turn: number;
  tokens: Partial<Record<UsageSource, number>>;
}

/** Aggregated usage across recorded turns. */
export interface UsageAggregate {
  turns: number;
  total: number;
  peak: number;
  peakTurn: number | null;
  bySource: Record<UsageSource, number>;
  share: Record<UsageSource, number>;
}

const SOURCES: UsageSource[] = [
  "system", "instructions", "history", "tools",
  "retrieval", "mentions", "skills", "compaction",
];

/** Append-only per-turn usage ledger. */
export class UsageLedger {
  private readonly turns: TurnUsage[] = [];

  /** Recorded turn count. */
  get size(): number {
    return this.turns.length;
  }

  /** Records one turn (negative values clamp to 0; NaN becomes 0). */
  record(turn: TurnUsage): void {
    const tokens: Partial<Record<UsageSource, number>> = {};
    for (const source of SOURCES) {
      const raw = turn.tokens[source] ?? 0;
      tokens[source] = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
    }
    this.turns.push({ turn: turn.turn, tokens });
  }

  /** Aggregates totals, peaks, and shares (zeros when empty). */
  aggregate(): UsageAggregate {
    const bySource = {} as Record<UsageSource, number>;
    for (const source of SOURCES) bySource[source] = 0;
    let total = 0;
    let peak = 0;
    let peakTurn: number | null = null;
    for (const record of this.turns) {
      let turnTotal = 0;
      for (const source of SOURCES) {
        const value = record.tokens[source] ?? 0;
        bySource[source] += value;
        turnTotal += value;
      }
      total += turnTotal;
      if (turnTotal > peak) {
        peak = turnTotal;
        peakTurn = record.turn;
      }
    }
    const share = {} as Record<UsageSource, number>;
    for (const source of SOURCES) share[source] = total === 0 ? 0 : bySource[source] / total;
    return { turns: this.turns.length, total, peak, peakTurn, bySource, share };
  }
}
