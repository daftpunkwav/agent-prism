/**
 * @file verification-policy
 * @description Port wrapping a driver attempt with verify/reflect/self-evolve loops.
 *
 * Responsibilities:
 * - Define the attempt and context shapes for verification
 *
 * The policy wraps driver.run, not a vendor agent object, so native and
 * LangChain/LangGraph share one semantic.
 */

import type { ChatMessage, PipelineConfig } from "./arena.js";
import type { HarnessLevel } from "./enums.js";
import type { ArenaEvent } from "./events.js";
import type { LlmAdapter } from "./llm-adapter.js";

/** One attempt factory: produces the event stream for a single driver.run. */
export type DriverAttempt = () => AsyncIterable<ArenaEvent>;

/** Inputs available to a verification policy for one column. */
export interface VerificationContext {
  config: PipelineConfig;
  question: string;
  history: ChatMessage[];
  /** LLM used for judge / reflect / evolve (may be the column model). */
  llm: LlmAdapter;
  signal?: AbortSignal;
}

/**
 * Verification policy selected by the harness dimension. bare yields the attempt
 * once; verify/reflect/self_evolve may retry up to a bounded number of times.
 */
export interface VerificationPolicy {
  readonly id: HarnessLevel;
  wrap(attempt: DriverAttempt, context: VerificationContext): AsyncIterable<ArenaEvent>;
}

/** Registry of verification policies; unknown harness levels fail closed. */
export interface VerificationPolicyRegistry {
  register(policy: VerificationPolicy): void;
  get(level: HarnessLevel): VerificationPolicy;
}
