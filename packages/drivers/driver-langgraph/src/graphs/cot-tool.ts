/**
 * @file graphs/cot-tool
 * @description Builds the LangGraph chain-of-thought + tool graph.
 *
 * Responsibilities:
 * - Assemble cot_tool nodes and edges on the shared AgentState
 */

import { SystemMessage } from "@langchain/core/messages";
import { END, START, StateGraph } from "@langchain/langgraph";
import { bindToolsSafe, streamToAiMessage } from "@agentprism/driver-langchain";
import { COT_ACT_PROMPT, COT_THINK_PROMPT } from "../prompts.js";
import { AgentState, hasToolCalls, llmMessages, stepBudgetExhausted, withNodeConfig, type AgentStateType, type ReasoningGraphDeps } from "./state.js";
import { reactToolNode } from "./tool-node.js";

async function cotThinkNode(state: AgentStateType, deps: ReasoningGraphDeps): Promise<Partial<AgentStateType>> {
  const response = await streamToAiMessage(
    deps.model,
    llmMessages(state, deps, [new SystemMessage(COT_THINK_PROMPT)]),
    deps.runnableConfig,
  );
  return { messages: [response], step_count: (state.step_count ?? 0) + 1 };
}

async function cotActNode(state: AgentStateType, deps: ReasoningGraphDeps): Promise<Partial<AgentStateType>> {
  const response = await streamToAiMessage(
    bindToolsSafe(deps.model, deps.lcTools),
    llmMessages(state, deps, [new SystemMessage(COT_ACT_PROMPT)]),
    deps.runnableConfig,
  );
  return { messages: [response], step_count: (state.step_count ?? 0) + 1 };
}

function cotShouldContinue(state: AgentStateType): "tools" | typeof END {
  if (stepBudgetExhausted(state)) return END;
  const messages = state.messages ?? [];
  if (hasToolCalls(messages[messages.length - 1])) return "tools";
  return END;
}

/**
 * Builds the chain-of-thought graph (think → act → tools loop back to think).
 *
 * @param deps Shared node dependencies (model, tools, grounding, retrieval).
 * @returns Uncompiled StateGraph; the driver compiles with the recursion limit.
 */
export function buildCotToolGraph(deps: ReasoningGraphDeps) {
  const graph = new StateGraph(AgentState)
    .addNode("think", (state: AgentStateType, config) => cotThinkNode(state, withNodeConfig(deps, config)))
    .addNode("act", (state: AgentStateType, config) => cotActNode(state, withNodeConfig(deps, config)))
    .addNode("tools", (state: AgentStateType) => reactToolNode(state, deps))
    .addEdge("think", "act")
    .addConditionalEdges("act", (state: AgentStateType) => cotShouldContinue(state), { tools: "tools", [END]: END })
    .addEdge("tools", "think");
  graph.addEdge(START, "think");
  return graph;
}
