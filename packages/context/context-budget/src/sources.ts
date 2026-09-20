/**
 * @file context-budget/sources
 * @description Named budget sources with weights for context allocation.
 *
 * Responsibilities:
 * - Declare the canonical allocation sources (system/tools/history/…)
 * - Validate weight tables (positive, finite, non-empty)
 *
 * Sources name the claimants competing for one fixed context budget. Weights
 * express relative priority, not absolute tokens: the allocator converts them
 * into shares of whatever budget the host supplies.
 */

export type BudgetSourceName =
  | "system"
  | "instructions"
  | "tools"
  | "history"
  | "retrieval"
  | "mentions"
  | "skills";

/** Weight table: source name to relative priority weight. */
export type SourceWeights = Partial<Record<BudgetSourceName, number>>;

/** Default weights (system and tools first, retrieval last). */
export const DEFAULT_SOURCE_WEIGHTS: Record<BudgetSourceName, number> = {
  system: 10,
  instructions: 8,
  tools: 6,
  history: 5,
  mentions: 4,
  skills: 3,
  retrieval: 2,
};

/** All source names in default priority order. */
export const SOURCE_NAMES: BudgetSourceName[] = [
  "system",
  "instructions",
  "tools",
  "history",
  "mentions",
  "skills",
  "retrieval",
];

/**
 * Normalizes a weight table into shares summing to 1.
 * Throws on empty, non-finite, or non-positive totals (fail-closed: a broken
 * table must never silently starve a source).
 */
export function normalizeWeights(weights: SourceWeights = {}): Record<BudgetSourceName, number> {
  const merged: Record<BudgetSourceName, number> = { ...DEFAULT_SOURCE_WEIGHTS, ...weights };
  const entries = SOURCE_NAMES.map((name) => ({ name, weight: merged[name] ?? 0 }));
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("Budget weights must sum to a positive finite total");
  }
  for (const entry of entries) {
    if (!Number.isFinite(entry.weight) || entry.weight < 0) {
      throw new Error(`Budget weight for ${entry.name} must be a finite non-negative number`);
    }
  }
  const out = {} as Record<BudgetSourceName, number>;
  for (const entry of entries) out[entry.name] = entry.weight / total;
  return out;
}
