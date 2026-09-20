/**
 * @file harness-runner
 * @description Compatibility barrel over the split verification modules.
 *
 * Responsibilities:
 * - Re-export judge/reflect/evolve/loop surfaces and EventStreamRunnable
 *
 * The legacy HarnessRunner class is removed; verification wraps driver.run
 * via runVerificationLoop in the agent package.
 */

export { verifyResult, type JudgeOptions as LlmJudgeOptions } from "./judge.js";
export { reflectOnFailure } from "./reflect.js";
export { proposeHarnessEdit } from "./evolve.js";
export { runVerificationLoop, type DriverAttemptFactory, type VerificationLoopDeps } from "./loop.js";

/** @deprecated Prefer graph.streamEvents directly; kept for transitional typing. */
export interface EventStreamRunnable {
  streamEvents: (input: unknown, options: Record<string, unknown>) => AsyncIterable<unknown>;
}
