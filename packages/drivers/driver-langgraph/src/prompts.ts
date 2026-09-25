/**
 * @file prompts
 * @description LangGraph driver's model-facing copy: ToT, CoT+tool, and reflexion
 *              phase prompts (single source; edit copy here only).
 *
 * Responsibilities:
 * - Own the tree-of-thought branch/score/select note templates
 * - Own the chain-of-thought think/act phase prompts
 * - Own the reflexion reflection prompt and answer wrapper
 *
 * Verbatim atoms shared with other drivers come from the harness phase blocks;
 * the `[ToT ...]`/`[Phase ...]` header formats stay local to this driver.
 */

import { PROPOSE_ONE_APPROACH, SCORE_REPLY_PROTOCOL } from "@agentprism/harness";

// ===== Tree of thought (graphs/tot) =====

/** Per-branch generation prompt (candidate plan, no tool use). */
export function totBranchPrompt(index: number, width: number): string {
  return `\n\n[ToT branch ${index + 1}/${width}]\n${PROPOSE_ONE_APPROACH}`;
}

/** Per-branch scoring prompt (plan rides in the transcript's previous message). */
export function totScorePrompt(index: number, width: number): string {
  return `\n\n[ToT score ${index + 1}/${width}]\nScore the plan proposed above 0-10 for likelihood of completing the task. ${SCORE_REPLY_PROTOCOL}`;
}

/** Selection note when no candidate was scored. */
export const TOT_SELECT_NO_CANDIDATES = "[ToT select] no candidates were scored; proceeding free-form";

/** Selection note announcing the winning branch and its plan. */
export function totSelectNote(best: number, width: number, score: number, plan: string): string {
  return `[ToT select] branch ${best + 1}/${width} wins with score ${score}\n${plan}`;
}

// ===== Chain of thought + tools (graphs/cot-tool) =====

/** Phase 1: reason without tools. */
export const COT_THINK_PROMPT =
  "\n\n[Phase 1: Reason]\nFully analyze the problem first. List all required steps and tools. Do not call tools; output reasoning only.";

/** Phase 2: act on the reasoning above. */
export const COT_ACT_PROMPT =
  "\n\n[Phase 2: Act]\nBased on the reasoning above, now perform the required tool calls.";

// ===== Reflexion (graphs/reflexion) =====

/** Reflection prompt: critique the drafted answer. */
export const REFLEXION_REFLECT_PROMPT =
  "\n\n[Reflexion: Reflect]\nEvaluate the quality of the answer above:\n1. Did it answer the question accurately?\n2. Is anything missing?\n3. How can it improve?\n\nIf insufficient, say what to retry or redo.\n\nOutput your reflection.";

/** User-message wrapper mounting the drafted answer for reflection. */
export function reflexionAnswerMessage(answer: string): string {
  return `Answer content:\n${answer}`;
}
