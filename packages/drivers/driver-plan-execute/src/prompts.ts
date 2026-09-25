/**
 * @file prompts
 * @description Plan-execute driver's model-facing copy: planner, branch/score,
 *              plan mounting, and replan templates (single source; edit copy here only).
 *
 * Responsibilities:
 * - Own the planner phase suffix and per-reasoning-mode planning instructions
 * - Own the ToT-style branch and score planner prompts (plan-execute's own
 *   variants; the wording differs from the executor drivers by design)
 * - Own the agreed-plan/revised-plan mount templates and the replan instruction
 */

// ===== Planner (invokePlanner / plannerPass) =====

/** Planner system suffix: planning is a reasoning-only phase. */
export const PLAN_PHASE_SUFFIX = "\n\n[Phase: Plan] Reason only; do not call tools.";

/** ToT-style planner branch instruction (appended after the task). */
export function planBranchPrompt(index: number, width: number): string {
  return `\n\n[Plan branch ${index + 1}/${width}] Propose ONE distinct solution approach (at most 4 steps) for the task above. No tool calls.`;
}

/** ToT-style planner score instruction (task and plan embedded). */
export function planScorePrompt(task: string, candidate: string): string {
  return `Score this plan 0-10 for likelihood of completing the task. Reply with "SCORE: <0-10>" first.\n\nTask:\n${task}\n\nPlan:\n${candidate}`;
}

/** cot_tool planning instruction: reason chain first, then a bounded plan. */
export const COT_PLAN_SUFFIX =
  "\n\nFirst analyze the problem and lay out your reasoning chain, then produce a short numbered plan (at most 6 steps). No tool calls.";

/** Direct planning instruction: a bounded numbered plan. */
export const DIRECT_PLAN_SUFFIX =
  "\n\nProduce a short numbered plan (at most 6 steps) for the task above. No tool calls.";

// ===== Plan mounting and replan (executor loop) =====

/** User-message template mounting the agreed plan under the task. */
export function agreedPlanMount(plan: string): string {
  return `[Agreed plan]\n${plan}\nFollow these steps; report deviations explicitly.`;
}

/** Replan instruction when the executor stalls without tool use. */
export const REPLAN_INSTRUCTION =
  "[Phase: Replan] Progress stalled without tool use. Revise the remaining steps briefly.";

/** User-message template mounting the revised plan. */
export function revisedPlanMount(revised: string): string {
  return `[Revised plan]\n${revised}`;
}
