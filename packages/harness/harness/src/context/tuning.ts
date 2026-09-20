/**
 * @file tuning
 * @description Operator-tunable context strategy budgets, injected per run.
 *
 * Responsibilities:
 * - Declare the optional per-run overrides for every context strategy budget
 * - Stay structurally compatible with AssembleOptions so drivers can spread it
 *
 * All fields are optional: absent fields fall back to each strategy's built-in
 * default, so the composition root only needs to set what the operator tuned.
 */

export interface ContextTuning {
  /** Message window for sliding/tool_tail/summary overflow (default 12). */
  windowSize?: number;
  /** Char-proxy token estimate divisor (default 4; CJK-heavy labs use lower). */
  charsPerToken?: number;
  /** Cap for the summary strategy's overflow digest (default 4000). */
  summaryMaxChars?: number;
  /** Character budget for the token_budget strategy (default 24000). */
  tokenBudgetChars?: number;
  /** Newest messages the token_budget strategy never sacrifices (default 6). */
  tokenBudgetKeepTurns?: number;
  /** Per-tool-result budget before tool_tail pruning (default 4000). */
  toolTailBudgetChars?: number;
  /** Tail chars tool_tail keeps verbatim for conclusions/errors (default 1200). */
  toolTailKeepChars?: number;
  /** Token pool for the budget strategy (default 6000). */
  budgetTokens?: number;
  /** Overflow target that triggers checkpoint compaction (default 2000). */
  compactTargetTokens?: number;
}
