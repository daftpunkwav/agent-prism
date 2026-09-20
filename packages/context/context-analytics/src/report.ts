/**
 * @file context-analytics/report
 * @description Deterministic text summaries for logs and narratives.
 *
 * Responsibilities:
 * - Render usage aggregates and strategy effectiveness as stable text
 * - Keep output short, sorted, and free of timestamps (diffable)
 */

import type { UsageAggregate } from "./usage.js";
import type { StrategyEffectiveness } from "./effectiveness.js";

/** Renders a usage aggregate as stable lines (empty aggregate → one line). */
export function renderUsageReport(aggregate: UsageAggregate): string {
  if (aggregate.turns === 0) return "[Context usage] no turns recorded";
  const sources = (Object.entries(aggregate.bySource) as Array<[string, number]>)
    .filter(([, tokens]) => tokens > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([source, tokens]) => `${source}=${tokens}`);
  return (
    `[Context usage] turns=${aggregate.turns} total=${aggregate.total} ` +
    `peak=${aggregate.peak}${aggregate.peakTurn === null ? "" : `@turn${aggregate.peakTurn}`} ` +
    `sources: ${sources.join(" ") || "(none)"}`
  );
}

/** Renders strategy effectiveness rows (empty → one line). */
export function renderEffectivenessReport(rows: StrategyEffectiveness[]): string {
  if (rows.length === 0) return "[Strategy effectiveness] no observations";
  return [
    "[Strategy effectiveness]",
    ...rows.map(
      (row) =>
        `${row.strategy}: n=${row.applications} keep=${row.meanKeepRate.toFixed(2)} ` +
        `dropped_tools=${row.totalToolResultsDropped} ledger=${row.ledgerRate.toFixed(2)}`,
    ),
  ].join("\n");
}
