/**
 * @file trajectory-judge
 * @description Port for execution-trajectory evaluation.
 *
 * Responsibilities:
 * - Define trajectory evaluation options and port interface
 *
 * The evaluation package supplies the implementation at the composition root.
 */

import type { ArenaEvent } from "./events.js";
import type { TrajectoryScore } from "./arena.js";
import type { LlmJudgeAdapter, LlmJudgeContext } from "./answer-judge.js";

/** Evaluation options for trajectory analysis. */
export interface TrajectoryJudgeOptions {
  /** Optional task question to evaluate relevance and alignment. */
  question?: string;
  /** Pass score threshold over [0, 1] (default 0.6). */
  passThreshold?: number;
}

/** Async evaluation options extending base options with LLM adapter. */
export interface TrajectoryJudgeAsyncOptions extends TrajectoryJudgeOptions {
  /** Injected LLM text-invoke port for deep qualitative review. */
  adapter?: LlmJudgeAdapter;
  /** Optional question context. */
  context?: LlmJudgeContext;
}

/** Judges column execution trajectories from the emitted ArenaEvent stream. */
export interface TrajectoryJudge {
  /** Pure deterministic trajectory evaluation from event trace. */
  evaluateTrajectory(events: readonly ArenaEvent[], options?: TrajectoryJudgeOptions): TrajectoryScore;
  /** Async trajectory evaluation, optionally leveraging an LLM judge. */
  evaluateTrajectoryAsync?(
    events: readonly ArenaEvent[],
    options?: TrajectoryJudgeAsyncOptions,
  ): Promise<TrajectoryScore>;
}
