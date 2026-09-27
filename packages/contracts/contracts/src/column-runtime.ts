/**
 * @file column-runtime
 * @description Per-column model handle assembled at the composition root.
 *
 * Responsibilities:
 * - Carry the framework-neutral LlmAdapter per column
 * - Provide llmVendor as an opaque escape hatch for vendor-bound drivers
 *
 * Native uses only llm (LlmAdapter); LangChain/LangGraph may read llmVendor.
 */

import type { LlmAdapter } from "./llm-adapter.js";
import type { LlmWireRecord } from "./builder.js";

/** Model + window metadata for one Arena column. */
export interface ColumnRuntime {
  llm: LlmAdapter;
  /** Opaque vendor chat model; typed only inside driver packages. */
  llmVendor: unknown;
  contextWindow: number;
  maxInputTokens: number;
}

/** Consumer of captured LLM wire records (request/response/error). Must never block the model loop. */
export type LlmWireSink = (record: LlmWireRecord) => void;

/**
 * One model call's outcome, reported where the call is observed, never inferred from
 * a column's end state: driver bugs and downstream faults are otherwise
 * indistinguishable, and a column that fails for its own reasons must not count
 * against the shared endpoint.
 *
 * Coverage is per COLUMN SHAPE, not per backend: the host reports from the callback
 * handler attached to the column's chat model, so columns whose calls go through
 * that model (the neutral drivers via the LlmAdapter, the LangChain family via
 * `llmVendor`) are observed, while a backend that runs its own model loop in a
 * subprocess (Claude Agent SDK) is not.
 */
export interface ModelCallOutcome {
  ok: boolean;
  /** Present on failures (transport, provider, or SDK error). */
  error?: unknown;
}

/** Optional per-column extras passed when the composition-root factory builds a runtime. */
export interface ColumnRuntimeCreateOptions {
  /** Receives every captured LLM wire record for this column (arena run logs). */
  wireSink?: LlmWireSink;
  /** Receives one outcome per model call (endpoint health for the arena breaker). */
  onModelCall?: (outcome: ModelCallOutcome) => void;
}

/** Factory port for building a ColumnRuntime from a pipeline config. */
export interface ColumnRuntimeFactory {
  create(config: import("./arena.js").PipelineConfig, options?: ColumnRuntimeCreateOptions): ColumnRuntime;
}
