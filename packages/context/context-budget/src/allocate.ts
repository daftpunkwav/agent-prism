/**
 * @file context-budget/allocate
 * @description Priority-ordered budget allocator with loud deficits.
 *
 * Responsibilities:
 * - Convert weight shares into per-source token allowances
 * - Spend allowances against measured demand, reporting deficits explicitly
 *
 * Allocation is priority-ordered, not proportional-fill: higher-weight sources
 * spend first up to their demand, and leftovers cascade down the priority
 * order. A source whose demand exceeds its allowance plus cascade reports a
 * deficit (how much was cut) instead of silently truncating — the caller
 * renders it into the prompt ledger.
 */

import { normalizeWeights, SOURCE_NAMES, type BudgetSourceName, type SourceWeights } from "./sources.js";

/** Measured demand per source in estimated tokens. */
export type SourceDemand = Partial<Record<BudgetSourceName, number>>;

export interface SourceAllocation {
  source: BudgetSourceName;
  /** Tokens granted (never exceeds demand). */
  granted: number;
  /** Tokens demanded. */
  demanded: number;
  /** Tokens cut (demanded minus granted, floored at 0). */
  deficit: number;
}

export interface AllocationResult {
  budget: number;
  allowances: SourceAllocation[];
  /** Total granted tokens (<= budget by construction). */
  spent: number;
  /** Total deficit tokens across sources. */
  totalDeficit: number;
}

/**
 * Allocates a token budget across sources by priority with cascade.
 * Demand values clamp at 0 (negative demand is a caller bug, not a credit).
 * Total granted never exceeds the budget; deficits name exactly what was cut.
 */
export function allocateBudget(
  budget: number,
  demand: SourceDemand,
  weights: SourceWeights = {},
): AllocationResult {
  if (!Number.isFinite(budget) || budget < 0) {
    throw new Error("Budget must be a finite non-negative number");
  }
  const shares = normalizeWeights(weights);
  const ordered = [...SOURCE_NAMES].sort((a, b) => (shares[b] ?? 0) - (shares[a] ?? 0) || (a < b ? -1 : 1));
  // Phase 1: proportional allowances from shares.
  const allowances = new Map<BudgetSourceName, number>();
  let assigned = 0;
  for (const source of ordered) {
    const allowance = Math.floor(budget * (shares[source] ?? 0));
    allowances.set(source, allowance);
    assigned += allowance;
  }
  // Flooring residue goes to the top-priority source (deterministic).
  if (ordered.length > 0) {
    const top = ordered[0] as BudgetSourceName;
    allowances.set(top, (allowances.get(top) ?? 0) + (budget - assigned));
  }
  // Phase 2: spend in priority order; unused allowance cascades down.
  const allocations: SourceAllocation[] = [];
  let cascade = 0;
  for (const source of ordered) {
    const rawDemand = demand[source] ?? 0;
    const demanded = Number.isFinite(rawDemand) ? Math.max(0, Math.floor(rawDemand)) : 0;
    const available = (allowances.get(source) ?? 0) + cascade;
    const granted = Math.min(demanded, available);
    cascade = available - granted;
    allocations.push({ source, granted, demanded, deficit: demanded - granted });
  }
  // Restore canonical source order for stable reports.
  allocations.sort((a, b) => SOURCE_NAMES.indexOf(a.source) - SOURCE_NAMES.indexOf(b.source));
  return {
    budget,
    allowances: allocations,
    spent: allocations.reduce((sum, allocation) => sum + allocation.granted, 0),
    totalDeficit: allocations.reduce((sum, allocation) => sum + allocation.deficit, 0),
  };
}
