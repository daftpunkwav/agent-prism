/**
 * @file agent-run-context
 * @description Legacy structural context types (identity, tool access, opaque handles).
 *
 * Responsibilities:
 * - Provide the shared member types re-exported by the harness execution context
 * - Keep the superseded AgentRunContext exported for compatibility (deprecated)
 *
 * Nothing constructs AgentRunContext: the agent layer builds the harness-owned
 * AgentExecutionContext instead. Drivers must not perform global lookups.
 * Step/tool counters stay private to each driver.
 */

import type { ChatMessage, PipelineConfig } from "./arena.js";
import type { Clock } from "./ports.js";
import type { ToolRegistry, ToolExecuteOptions } from "./tool-registry.js";
import type { LlmAdapter } from "./llm-adapter.js";
import type { ContextPolicy } from "./context-policy.js";

/** Stable agent identity: aggregation and isolation key, never a display label. */
export interface AgentIdentity {
  agentId: string;
  runId: string;
}

/**
 * Column-scoped tool access: authorized names plus the shared execute entry.
 * Side-effect hooks (RAG invalidation, guards) attach via execute options.
 */
export interface ToolAccess {
  registry: ToolRegistry;
  names: ReadonlySet<string>;
  execute(
    name: string,
    args: Record<string, unknown>,
    options?: Omit<ToolExecuteOptions, "authorizedNames">,
  ): Promise<import("./tool-registry.js").ToolExecutionResult>;
}

/**
 * Opaque workspace handle. Drivers that need FS APIs cast through runtime types
 * at the boundary; contracts stay free of filesystem imports.
 */
export type WorkspaceHandle = unknown;

/** Opaque token tracker handle owned by telemetry. */
export type TokenTrackerHandle = unknown;

/** Opaque RAG cache handle owned by the harness memory module. */
export type RagCacheHandle = unknown;

/**
 * Superseded composed context (kept exported for compatibility; do not use in new code).
 * @deprecated Build and consume the harness-owned AgentExecutionContext instead: this
 * interface additionally requires contextPolicy, which no runner provides, so no live
 * context satisfies it. LangChain message types must not appear here.
 */
export interface AgentRunContext {
  identity: AgentIdentity;
  config: PipelineConfig;
  question: string;
  history: ChatMessage[];
  /** 1-based multi-turn turn number. */
  turn: number;
  workspace: WorkspaceHandle;
  tracker: TokenTrackerHandle;
  clock: Clock;
  rag: RagCacheHandle;
  llm: LlmAdapter;
  /** Opaque vendor model for LC/LG drivers only; Native must ignore this. */
  llmVendor: unknown;
  tools: ToolAccess;
  contextPolicy: ContextPolicy;
  signal?: AbortSignal;
}
