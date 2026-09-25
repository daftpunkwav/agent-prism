/**
 * @file step-budget
 * @description Executor turn cap derived from the max_steps dimension.
 *
 * Responsibilities:
 * - Translate a column's max_steps value into the bound every driver loop compares against
 * - Map the unlimited sentinel to an unbounded cap, and non-finite input to one turn
 *
 * Single source of truth: a driver that re-derives this bound can collapse
 * "unlimited" to a single turn and end the run before the answer round.
 * Graph-shaped backends use the sibling recursionLimitFor instead.
 */

/**
 * Turn cap for a max_steps value: unlimited budgets return Infinity.
 *
 * @param maxSteps Column step budget; the -1 contract sentinel means unlimited.
 *   Any negative value is treated the same way (persisted configs may arrive
 *   unvalidated), matching the deliberately wider guard in recursionLimitFor.
 * @returns Turn count a driver loop may run: at least one, or Infinity when unlimited.
 */
export function stepBudgetFor(maxSteps: number): number {
  // Math.max(1, NaN) is NaN, which would skip the loop entirely and let the
  // driver report success for a run that did no work at all.
  if (!Number.isFinite(maxSteps)) return 1;
  if (maxSteps < 0) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.trunc(maxSteps));
}
