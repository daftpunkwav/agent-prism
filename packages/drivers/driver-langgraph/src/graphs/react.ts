/**
 * @file graphs/react
 * @description Builds the LangGraph ReAct reasoning graph.
 *
 * Responsibilities:
 * - Assemble ReAct nodes and edges on the shared AgentState
 */

import { END, START, StateGraph } from "@langchain/langgraph";
import { bindToolsSafe, streamToAiMessage } from "@agentprism/driver-langchain";
import { AgentState, hasToolCalls, llmMessages, stepBudgetExhausted, withNodeConfig, type AgentStateType, type ReasoningGraphDeps } from "./state.js";
import { reactToolNode } from "./tool-node.js";

async function reactNode(state: AgentStateType, deps: ReasoningGraphDeps): Promise<Partial<AgentStateType>> {
  const response = await streamToAiMessage(
    bindToolsSafe(deps.model, deps.lcTools),
    llmMessages(state, deps),
    deps.runnableConfig,
  );
  return { messages: [response], step_count: (state.step_count ?? 0) + 1 };
}

function reactShouldContinue(state: AgentStateType): "tools" | typeof END {
  if (stepBudgetExhausted(state)) return END;
  const messages = state.messages ?? [];
  const lastMessage = messages[messages.length - 1];
  if (hasToolCalls(lastMessage)) return "tools";
  return END;
}

/**
 * Builds the ReAct loop graph (agent ↔ tools until no tool calls or step budget).
 *
 * @param deps Shared node dependencies (model, tools, grounding, retrieval).
 * @returns Uncompiled StateGraph; the driver compiles with the recursion limit.
 */
export function buildReactGraph(deps: ReasoningGraphDeps) {
  const graph = new StateGraph(AgentState)
    .addNode("agent", (state: AgentStateType, config) => reactNode(state, withNodeConfig(deps, config)))
    .addNode("tools", (state: AgentStateType) => reactToolNode(state, deps))
    .addEdge("tools", "agent")
    .addConditionalEdges("agent", (state: AgentStateType) => reactShouldContinue(state), { tools: "tools", [END]: END });
  graph.addEdge(START, "agent");
  return graph;
}
