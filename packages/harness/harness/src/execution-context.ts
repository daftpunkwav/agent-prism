/**
 * @file execution-context
 * @description The agent execution context: the composed result of injection.
 *
 * Responsibilities:
 * - Carry identity, workspace, llm, tools, and tracker explicitly
 *
 * Any form of global lookup is forbidden. Step/tool counters are owned
 * privately by each driver, not part of this shared contract.
 */

import type {
  AgentIdentity,
  ChatTurnMessage,
  Clock,
  ContextTuning,
  LlmAdapter,
  MemoryRecallResult,
  ModelCallOutcome,
  PipelineConfig,
  ToolAccess,
  ToolRegistry,
} from "@agentprism/contracts";
import type { ContextAnalytics } from "./context/analytics.js";
import type { ActiveCustomDimension } from "./dimensions/custom-dimensions.js";
import type { CustomDimensionRun } from "./dimensions/custom-dimension-hooks.js";
import type { RagStoreCache } from "./memory/rag.js";
import type { Workspace } from "@agentprism/runtime";
import type { TokenTracker } from "@agentprism/telemetry";

// Identity and tool-access shapes are single-sourced in contracts (agent-run-context):
// re-exported here so existing harness importers keep working without rewiring.
export type { AgentIdentity, ToolAccess } from "@agentprism/contracts";

/**
 * What `AgentExecutionContext.contextTuning` carries: the operator's per-run
 * budgets (contracts' ContextTuning) plus the run's active custom dimensions,
 * which every driver must forward into the context pipeline.
 *
 * Deliberately narrower than `ContextPipelineOptions`: the pipeline-only switches
 * (`analytics`, `sanitizeAndGround`, `retrieveSnippets`) are injected by each
 * driver itself, so they must not be settable through a field documented as
 * budgets — a caller disabling the sanitize/grounding tail from a "tuning" bag
 * would silently change what every column sends to the provider.
 */
export interface RunContextTuning extends ContextTuning {
  /** Active custom dimensions (the pipeline runs their `messages` hooks). */
  customDimensions?: readonly ActiveCustomDimension[];
  /** Run facts custom-dimension hooks may consult (question + configured values). */
  customRun?: CustomDimensionRun;
}

/**
 * Agent execution context: the composed result of dependency injection. Explicitly
 * carries identity/workspace/llm/tools/tracker; any global lookup is forbidden.
 * Step/tool counters are maintained autonomously by each driver, not part of the
 * shared contract. LangChain ChatModel types must not appear here — the
 * LangChain family casts llmVendor via requireChatModel inside the drivers package.
 */
export interface AgentExecutionContext {
  identity: AgentIdentity;
  config: PipelineConfig;
  question: string;
  history: ChatTurnMessage[];
  /** UI locale tag steering the agent's reply language ("" / absent = mirror the user). */
  language?: string;
  /** 1-based multi-turn turn number. */
  turn: number;
  workspace: Workspace;
  tracker: TokenTracker;
  /** Time source (injected; business code must never read system time directly). */
  clock: Clock;
  /** RAG retrieval cache for this run (invalidated after tools write files). */
  rag: RagStoreCache;
  /** Framework-neutral LLM port (verification + future Native text path). */
  llm: LlmAdapter;
  /** Opaque vendor chat model for the tool-bound loops (LangChain family, Native). */
  llmVendor: unknown;
  tools: ToolAccess;
  /**
   * Feedback injected by the verification loop between retries (reflect /
   * self_evolve). Empty on the first attempt.
   */
  verificationFeedback?: string;
  /**
   * Session-level notices rendered into the system prompt (tool hot-swap
   * announcements, capability changes). Optional; drivers that skip
   * buildSystemUser simply do not surface them.
   */
  notices?: readonly string[];
  /** Custom system prompt block; when non-empty it replaces the profile section. */
  systemPromptOverride?: string;
  /** Preloaded skill runbook block (injected when skill_policy=preloaded; stays empty otherwise). */
  skillPreloadBlock?: string;
  /** Cross-session memory recall mounted into the prompt (absent/empty = stateless). */
  memoryRecall?: MemoryRecallResult;
  /** Per-run context analytics seam (usage ledger + effectiveness log); optional. */
  contextAnalytics?: ContextAnalytics;
  /**
   * Operator-tuned context strategy budgets (window sizes, char/token budgets),
   * already folded with the run's custom-dimension hooks. Optional: absent fields
   * keep each strategy's built-in default. Drivers spread this into
   * applyContextPipeline, which is also how the `messages` hooks reach every call
   * site; prompt assembly reads `customDimensions` for the prompt/memory seams.
   */
  contextTuning?: RunContextTuning;
  /**
   * Active custom dimensions of this run (resolved from config.custom at the run
   * assembly). Prompt assembly applies their `prompt`/`memory` hooks and their
   * prompt tags; the context pipeline applies their `messages` hooks.
   */
  customDimensions?: readonly ActiveCustomDimension[];
  /**
   * Endpoint-health hook for drivers that own their model transport. A driver whose
   * calls go through the column's chat model does NOT report here (the model callbacks
   * observe those); a driver that runs its own loop — today the Claude Agent SDK CLI
   * subprocess — reports what it observes, so the endpoint it shares with the other
   * columns is not the one column the arena breaker cannot see.
   *
   * Granularity is per driver: report one outcome per call you can observe, or your
   * terminal outcome when the calls are opaque. Cancellation is never a fault.
   */
  onModelCall?: (outcome: ModelCallOutcome) => void;
  signal?: AbortSignal;
}
