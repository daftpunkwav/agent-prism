/**
 * @file context-policy
 * @description Port for trimming and grounding the message list before each model call.
 *
 * Responsibilities:
 * - Define the ContextPolicy and registry interfaces over LlmMessage
 *
 * All drivers must apply the same policy so Arena comparisons stay fair
 * across frameworks; vendor Chat SDK classes never appear here.
 */

import type { PipelineConfig } from "./arena.js";
import type { ContextStrategy } from "./enums.js";
import type { LlmMessage } from "./llm-message.js";

/** Inputs for one context-policy application. */
export interface ContextPolicyInput {
  messages: LlmMessage[];
  config: PipelineConfig;
  question: string;
  /** Optional retrieval helper for vector/hybrid strategies. */
  retrieveSnippets?: (query: string) => Promise<string> | string;
  maxInputTokens: number;
}

/** Context assembly policy selected by the context dimension. */
export interface ContextPolicy {
  readonly id: ContextStrategy;
  apply(input: ContextPolicyInput): Promise<LlmMessage[]> | LlmMessage[];
}

/**
 * Externally contributed context strategy (the custom-dimension subpackage
 * seam). A subpackage exports plugins; the host registers them and the
 * context dimension surfaces id/label automatically. apply() only shapes the
 * replayed message list — sanitize and tool grounding run afterwards.
 */
export interface ContextStrategyPlugin {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  apply(messages: LlmMessage[]): LlmMessage[];
}

/** Registry of context policies; unknown strategy ids fail closed. */
export interface ContextPolicyRegistry {
  register(policy: ContextPolicy): void;
  get(strategy: ContextStrategy): ContextPolicy;
  /** Registered strategy ids (for meta projection). */
  listIds(): string[];
}

/** @deprecated Prefer LlmMessage; kept as an alias during migration. */
export type ContextMessage = LlmMessage;
