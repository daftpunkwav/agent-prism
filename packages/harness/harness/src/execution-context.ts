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
  LlmAdapter,
  MemoryRecallResult,
  PipelineConfig,
  ToolAccess,
  ToolExecuteOptions,
  ToolExecutionResult,
  ToolRegistry,
} from "@agentprism/contracts";
import type { ContextAnalytics } from "./context/analytics.js";
import type { ContextTuning } from "./context/tuning.js";
import type { RagStoreCache } from "./memory/rag.js";
import type { Workspace } from "@agentprism/runtime";
import type { TokenTracker } from "@agentprism/telemetry";

// Identity and tool-access shapes are single-sourced in contracts (agent-run-context):
// re-exported here so existing harness importers keep working without rewiring.
export type { AgentIdentity, ToolAccess } from "@agentprism/contracts";

/**
 * Agent execution context: the composed result of dependency injection. Explicitly
 * carries identity/workspace/llm/tools/tracker; any global lookup is forbidden.
 * Step/tool counters are maintained autonomously by each driver, not part of the
 * shared contract. LangChain ChatModel types must not appear here — LC/LG cast
 * llmVendor via requireChatModel inside the drivers package.
 */
export interface AgentExecutionContext {
  identity: AgentIdentity;
  config: PipelineConfig;
  question: string;
  history: ChatTurnMessage[];
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
  /** Opaque vendor chat model for LC/LG/Native tool-bound loops. */
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
   * Operator-tuned context strategy budgets (window sizes, char/token budgets).
   * Optional: absent fields keep each strategy's built-in default. Drivers
   * spread this into applyContextPipeline so tuning reaches every LLM call.
   */
  contextTuning?: ContextTuning;
  signal?: AbortSignal;
}
