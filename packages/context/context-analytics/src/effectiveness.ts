/**
 * @file context-analytics/effectiveness
 * @description Strategy effectiveness counters for ablation grounding.
 *
 * Responsibilities:
 * - Count kept/dropped/ledger-marked message volume per strategy
 * - Derive keep-rates and drop profiles comparable across strategies
 *
 * Effectiveness is behavioral, not judgmental: it records what each strategy
 * did to the transcript (kept X chars, dropped Y tool results, emitted a
 * ledger), leaving pass/fail verdicts to the evaluation judge. The evaluation
 * ablation rows consume these counters to ground "did the strategy matter".
 */

export type StrategyName =
  | "sliding"
  | "summary"
  | "vector"
  | "hybrid"
  | "tool_tail"
  | "token_budget"
  | "checkpoint"
  | "budget";

/** One observed strategy application. */
export interface StrategyObservation {
  strategy: StrategyName;
  /** Input message count. */
  inputMessages: number;
  /** Output message count. */
  outputMessages: number;
  /** Input chars. */
  inputChars: number;
  /** Output chars. */
  outputChars: number;
  /** Tool-result messages dropped (0 when the strategy never drops). */
  toolResultsDropped: number;
  /** Whether a loss ledger/notice was emitted. */
  ledgerEmitted: boolean;
}

/** Aggregated effectiveness for one strategy. */
export interface StrategyEffectiveness {
  strategy: StrategyName;
  applications: number;
  /** Mean output/input char ratio (compression achieved). */
  meanKeepRate: number;
  /** Total tool results dropped. */
  totalToolResultsDropped: number;
  /** Share of applications emitting a ledger. */
  ledgerRate: number;
}

/** Append-only strategy observation log. */
export class EffectivenessLog {
  private readonly observations: StrategyObservation[] = [];

  /** Observation count. */
  get size(): number {
    return this.observations.length;
  }

  /** Records one strategy application (counts clamp at 0). */
  observe(observation: StrategyObservation): void {
    const clamp = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);
    this.observations.push({
      strategy: observation.strategy,
      inputMessages: clamp(observation.inputMessages),
      outputMessages: clamp(observation.outputMessages),
      inputChars: clamp(observation.inputChars),
      outputChars: clamp(observation.outputChars),
      toolResultsDropped: clamp(observation.toolResultsDropped),
      ledgerEmitted: observation.ledgerEmitted,
    });
  }

  /** Effectiveness per strategy, in first-seen order. */
  effectiveness(): StrategyEffectiveness[] {
    const groups = new Map<StrategyName, StrategyObservation[]>();
    for (const observation of this.observations) {
      const group = groups.get(observation.strategy) ?? [];
      group.push(observation);
      groups.set(observation.strategy, group);
    }
    return [...groups.entries()].map(([strategy, items]) => {
      const keepRates = items.map((item) => (item.inputChars === 0 ? 1 : item.outputChars / item.inputChars));
      const meanKeepRate = keepRates.reduce((sum, rate) => sum + rate, 0) / Math.max(1, keepRates.length);
      return {
        strategy,
        applications: items.length,
        meanKeepRate,
        totalToolResultsDropped: items.reduce((sum, item) => sum + item.toolResultsDropped, 0),
        ledgerRate: items.filter((item) => item.ledgerEmitted).length / Math.max(1, items.length),
      };
    });
  }
}
