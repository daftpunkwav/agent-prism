/**
 * @file recursion-limit
 * @description Graph recursion limit shared by LangChain/LangGraph.
 *
 * Responsibilities:
 * - Derive the limit from max_steps (5x, floor 50); unlimited steps get the unbounded ceiling
 *
 * Single source of truth: a ReAct-shaped graph consumes about 2 counts per
 * LLM call; the floor covers short tasks where 5x is still small.
 */

/**
 * Recursion ceiling standing in for "unlimited steps": LangGraph requires a
 * finite limit, and 200k graph steps (~100k LLM turns) takes days of wall-clock
 * time — abort/disconnect remains the real stopper long before this is hit.
 */
export const UNBOUNDED_RECURSION_LIMIT = 200_000;

/**
 * Derives the graph recursion limit from max_steps (5x, floor 50; non-finite falls back to 50).
 *
 * @param maxSteps Column step budget; the -1 contract sentinel means unlimited.
 *   Any negative value maps to the unbounded ceiling (persisted configs may
 *   arrive unvalidated, so the guard is deliberately wider than the sentinel).
 * @returns Recursion limit that never hangs the graph on NaN input.
 */
export function recursionLimitFor(maxSteps: number): number {
  // Math.max propagates NaN, which would hand the graph an undefined recursion limit.
  if (!Number.isFinite(maxSteps)) return 50;
  if (maxSteps < 0) return UNBOUNDED_RECURSION_LIMIT;
  return Math.max(50, Math.trunc(maxSteps) * 5);
}
