/**
 * @file graphs/state
 * @description Shared state and helpers for LangGraph reasoning graphs.
 *
 * Responsibilities:
 * - Define AgentState and its typed shape
 * - Provide node config, message, and tool-call helpers
 */

import { AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { Annotation, MessagesAnnotation } from "@langchain/langgraph";
import { applyContextPipeline } from "@agentprism/harness";
import type { ContextTuning, ToolAccess } from "@agentprism/harness";
import type { ToolExecutionResult } from "@agentprism/contracts";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import { fromLcMessages, toLcMessages } from "@agentprism/driver-langchain";

/** One scored ToT branch: the candidate plan text and its 0-10 evaluation. */
export interface TotCandidate {
  plan: string;
  score: number;
}

/** Agent graph state: messages use the addMessages reducer (nodes return deltas, never overwrite). */
export const AgentState = Annotation.Root({
  messages: MessagesAnnotation.spec.messages,
  step_count: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  max_steps: Annotation<number>({ reducer: (_, b) => b, default: () => 10 }),
  tool_calls: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  reflections: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  context_strategy: Annotation<string>({ reducer: (_, b) => b, default: () => "sliding" }),
  // ToT branches append one candidate per score node; the concat reducer merges
  // the per-node writes so selection sees every scored branch in order.
  candidates: Annotation<TotCandidate[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
});

export type AgentStateType = typeof AgentState.State;

export interface ReasoningGraphDeps {
  model: BaseChatModel;
  tools: ToolAccess;
  /** LangChain bindings that delegate to tools.execute. */
  lcTools: StructuredToolInterface[];
  /** Workspace retrieval before each model call for vector/hybrid strategies (built by the driver from the execution context). */
  retrieveSnippets?: (query: string) => string;
  /** Operator-tuned context strategy budgets (absent fields keep built-in defaults). */
  contextTuning?: ContextTuning;
  /** Harness level for the tool drift guard ("bare" disables the guard). */
  harness?: string;
  signal?: AbortSignal;
  /** Runnable config so nested model.stream() is visible to graph.streamEvents. */
  runnableConfig?: RunnableConfig;
  /**
   * Custom tool nodes do not go through LC StructuredTool invoke, so streamEvents
   * will not emit on_tool_*; the driver records action/file_diff/observation here.
   */
  onToolExecuted?: (name: string, args: Record<string, unknown>, outcome: ToolExecutionResult) => void;
  /**
   * Fires synchronously before each tool executes (same threading as onToolExecuted).
   * The driver emits the action row here so interactive tools (ask_user waits up to
   * 5 min) pop their per-column window while waiting instead of after completion.
   */
  onToolStart?: (name: string, args: Record<string, unknown>) => void;
}

/** Copies deps with the node-level runnable config so nested .stream() is traced by streamEvents. */
export function withNodeConfig(deps: ReasoningGraphDeps, config: RunnableConfig | undefined): ReasoningGraphDeps {
  return config === undefined ? deps : { ...deps, runnableConfig: config };
}

/** Trim → sanitize → anchor via harness LlmMessage pipeline; convert at the LC boundary. */
export function llmMessages(state: AgentStateType, deps: ReasoningGraphDeps, extra?: BaseMessage[]): BaseMessage[] {
  const strategy = state.context_strategy || "sliding";
  const grounded = toLcMessages(
    applyContextPipeline(fromLcMessages(state.messages ?? []), strategy, {
      retrieveSnippets: deps.retrieveSnippets,
      ...deps.contextTuning,
    }),
  );
  if (extra && extra.length > 0) return [...grounded, ...extra];
  return grounded;
}

/** True when an AI message carries at least one tool call (routes to tool nodes). */
export function hasToolCalls(message: BaseMessage | undefined): boolean {
  const calls = (message as AIMessage | undefined)?.tool_calls;
  return Array.isArray(calls) && calls.length > 0;
}

/**
 * Whether the step budget is exhausted (max_steps counts LLM turns, unified with
 * the native driver: each agent-node execution adds 1 step). A negative max_steps
 * is the unlimited sentinel: the budget never ends and the graph recursion limit
 * (see recursionLimitFor) stays the only graph-side bound.
 */
export function stepBudgetExhausted(state: AgentStateType): boolean {
  const maxSteps = state.max_steps ?? 10;
  if (maxSteps < 0) return false;
  return (state.step_count ?? 0) >= maxSteps;
}
