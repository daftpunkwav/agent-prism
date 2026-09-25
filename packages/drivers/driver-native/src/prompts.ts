/**
 * @file prompts
 * @description Native driver's model-facing copy: reasoning-phase hint templates
 *              (single source; edit copy here only).
 *
 * Responsibilities:
 * - Own the CoT/ToT/reflexion phase hint texts the native driver appends as
 *   neutral user messages between phases
 *
 * The ToT propose/score lines compose the harness phase blocks — the same
 * verbatim atoms the LangGraph driver embeds — so wording changes land in one
 * place; the `[Phase: ...]` header format stays local to this driver.
 */

import { PROPOSE_ONE_APPROACH, SCORE_REPLY_PROTOCOL } from "@agentprism/harness";

// ===== Phase hints (reasoning-state) =====

/** CoT think phase: reason first, no tools. */
export const COT_PHASE_HINT =
  "[Phase: CoT] Reason only; do not call tools. List a plan before acting.";

/** ToT think phase: propose one distinct approach for the current branch. */
export function totBranchHint(round: number, width: number): string {
  return `[Phase: ToT branch ${round + 1}/${width}] ${PROPOSE_ONE_APPROACH}`;
}

/** ToT evaluate phase: score the current branch's plan (plan body embedded). */
export function totScoreHint(round: number, width: number, plan: string): string {
  return (
    `[Phase: ToT score ${round + 1}/${width}] Score this plan 0-10 for likelihood of completing the task. ` +
    `${SCORE_REPLY_PROTOCOL}\nPlan:\n${plan}`
  );
}

/** Reflexion reflect phase: critique the current result. */
export const REFLEXION_PHASE_HINT =
  "[Phase: Reflect] Evaluate whether the current result completes the task; if insufficient, say what to improve or redo.";
