/**
 * @file context-budget/ledger
 * @description Allocation ledger rendering for prompts.
 *
 * Responsibilities:
 * - Render allocation results as `[Budget ledger]` prompt lines
 * - Keep ledgers short, stable, and explicit about cuts
 *
 * The ledger tells the model exactly what survived budgeting and what was
 * cut, so it re-reads files instead of hallucinating dropped content.
 */

import type { AllocationResult } from "./allocate.js";

/**
 * Renders one ledger line (empty string when nothing was cut and spending
 * fits: silence is cleaner than a ledger that says nothing).
 */
export function renderBudgetLedger(result: AllocationResult): string {
  const cut = result.allowances.filter((allocation) => allocation.deficit > 0);
  if (cut.length === 0) return "";
  const parts = cut.map((allocation) => `${allocation.source} -${allocation.deficit}`);
  return (
    `[Budget ledger] budget ${result.budget}, spent ${result.spent}; ` +
    `cut: ${parts.join(", ")}. Re-read sources instead of guessing dropped content.`
  );
}
