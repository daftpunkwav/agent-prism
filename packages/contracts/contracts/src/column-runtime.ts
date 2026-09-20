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

/** Optional per-column extras passed when the composition-root factory builds a runtime. */
export interface ColumnRuntimeCreateOptions {
  /** Receives every captured LLM wire record for this column (arena run logs). */
  wireSink?: LlmWireSink;
}

/** Factory port for building a ColumnRuntime from a pipeline config. */
export interface ColumnRuntimeFactory {
  create(config: import("./arena.js").PipelineConfig, options?: ColumnRuntimeCreateOptions): ColumnRuntime;
}
