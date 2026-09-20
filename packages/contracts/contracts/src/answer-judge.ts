/**
 * @file answer-judge
 * @description Port for deterministic template judging.
 *
 * Responsibilities:
 * - Define the judge interface the application depends on
 *
 * The evaluation package supplies the implementation at the composition root.
 */

import type { JudgeResult, JudgeSpec } from "./arena.js";

/** Minimal LLM text-invoke port for async judging (host supplies the model call). */
export interface LlmJudgeAdapter {
  invoke(prompt: string): Promise<string>;
}

/** Optional question context for LLM judging (templates carry the question). */
export interface LlmJudgeContext {
  question?: string;
}

/** Judges column answers against a template JudgeSpec. */
export interface AnswerJudge {
  judgeAnswers(answers: Record<string, string>, spec: JudgeSpec): Record<string, JudgeResult>;
  /** Async LLM judging (bound to a judge model at the composition root; absent = llm specs fail closed). */
  judgeAnswersAsync?: (
    answers: Record<string, string>,
    spec: JudgeSpec,
    context?: LlmJudgeContext,
  ) => Promise<Record<string, JudgeResult>>;
}
