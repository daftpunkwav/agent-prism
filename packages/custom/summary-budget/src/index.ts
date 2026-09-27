/**
 * @file summary-budget
 * @description Custom dimension: how much room the summary strategy keeps.
 *
 * Responsibilities:
 * - Declare the summary-budget dimension and its token-denominated options
 * - Translate the selected budget into the summary digest cap (the hook)
 *
 * The builtin `summary`/`hybrid` strategies digest older turns into one system
 * message whose size is capped by `ContextTuning.summaryMaxChars` (a *character*
 * budget, default 4000). This dimension makes that budget the comparison axis:
 * a bigger digest keeps more of the old transcript, a smaller one costs fewer
 * tokens and drops more detail. Token values are converted with the run's own
 * char-per-token divisor, so the axis keeps its meaning when an operator retunes
 * `charsPerToken` for CJK-heavy labs.
 *
 * Reference implementation for a custom dimension package — copy this package,
 * rename the id/options, and swap the hook.
 */

import type { ContextTuning, CustomDimension } from "@agentprism/contracts";

/** Char-proxy divisor used when the run carries no explicit tuning. */
const DEFAULT_CHARS_PER_TOKEN = 4;

/** Options carry token counts; `2k` is 2000 estimated tokens. */
function tokensOf(value: string): number {
  const numeric = Number(value.replace(/k$/i, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return value.toLowerCase().endsWith("k") ? Math.round(numeric * 1000) : Math.round(numeric);
}

/**
 * Summary digest cap for one option value: `tokens × charsPerToken` characters.
 * Exported so the unit test can pin the conversion without going through a run.
 */
export function summaryMaxCharsFor(value: string, base: ContextTuning): number {
  const tokens = tokensOf(value);
  if (tokens === 0) return 0;
  const charsPerToken = base.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN;
  return tokens * charsPerToken;
}

/** The summary-budget dimension: 2k / 5k / 8k estimated tokens of digest. */
export const summaryBudgetDimension: CustomDimension = {
  id: "summary_budget",
  label: "Summary budget",
  subtitle: "How much digested history the summary strategy keeps (estimated tokens)",
  options: [
    { value: "2000", label: "2k tokens", description: "Small digest: cheapest, drops the most older detail." },
    { value: "5000", label: "5k tokens", description: "Medium digest (5k): balanced default for long sessions." },
    { value: "8000", label: "8k tokens", description: "Large digest: keeps the most older detail, costs more per call." },
  ],
  default: "5000",
  promptHint: "\n[Context: summary digest budget {value} tokens]",
  hooks: {
    contextTuning: (value, base) => ({ summaryMaxChars: summaryMaxCharsFor(value, base) }),
  },
};
