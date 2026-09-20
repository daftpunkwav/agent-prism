/**
 * @file graphs/reflexion
 * @description Builds the LangGraph reflexion reasoning graph.
 *
 * Responsibilities:
 * - Assemble reflexion (draft, reflect, retry) nodes on the shared AgentState
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { END, START, StateGraph } from "@langchain/langgraph";
import { textFromContent } from "@agentprism/contracts";
import { REFLEXION_RETRY_KEYWORDS } from "@agentprism/driver-registry";
import { bindToolsSafe, streamToAiMessage } from "@agentprism/driver-langchain";
import { AgentState, hasToolCalls, llmMessages, stepBudgetExhausted, withNodeConfig, type AgentStateType, type ReasoningGraphDeps } from "./state.js";
import { reactToolNode } from "./tool-node.js";

async function reflexionExecuteNode(state: AgentStateType, deps: ReasoningGraphDeps): Promise<Partial<AgentStateType>> {
  const response = await streamToAiMessage(
    bindToolsSafe(deps.model, deps.lcTools),
    llmMessages(state, deps),
    deps.runnableConfig,
  );
  return { messages: [response], step_count: (state.step_count ?? 0) + 1 };
}

async function reflexionReflectNode(state: AgentStateType, deps: ReasoningGraphDeps): Promise<Partial<AgentStateType>> {
  const messages = state.messages ?? [];
  const lastMessage = messages[messages.length - 1];
  const lastResponse = lastMessage === undefined ? "" : textFromContent(lastMessage.content);
  const response = await streamToAiMessage(
    deps.model,
    [
      new SystemMessage(
        "\n\n[Reflexion: Reflect]\nEvaluate the quality of the answer above:\n1. Did it answer the question accurately?\n2. Is anything missing?\n3. How can it improve?\n\nIf insufficient, say what to retry or redo.\n\nOutput your reflection.",
      ),
      new HumanMessage(`Answer content:\n${lastResponse}`),
    ],
    deps.runnableConfig,
  );
  // Deliberately outside the max_steps budget (unlike execute nodes): reflection is bounded
  // instead by the step budget consumed on execute turns plus keyword gating, so one critique
  // pass always fits after the last work turn. Metrics steps still count this call.
  return { messages: [response], reflections: [...(state.reflections ?? []), textFromContent(response.content)] };
}

function reflexionAfterExecute(state: AgentStateType): "tools" | "reflect" {
  const messages = state.messages ?? [];
  if (messages.length === 0) return "reflect";
  const lastMessage = messages[messages.length - 1];
  if (hasToolCalls(lastMessage)) {
    if (stepBudgetExhausted(state)) return "reflect";
    return "tools";
  }
  return "reflect";
}

function reflexionShouldContinue(state: AgentStateType): "execute" | typeof END {
  if (stepBudgetExhausted(state)) return END;
  const reflections = state.reflections ?? [];
  const lastReflection = reflections[reflections.length - 1] ?? "";
  if (REFLEXION_RETRY_KEYWORDS.some((keyword) => lastReflection.includes(keyword))) {
    return "execute";
  }
  return END;
}

/**
 * Builds the reflexion graph (execute → tools/reflect loop with retry keywords).
 *
 * @param deps Shared node dependencies (model, tools, grounding, retrieval).
 * @returns Uncompiled StateGraph; the driver compiles with the recursion limit.
 */
export function buildReflexionGraph(deps: ReasoningGraphDeps) {
  const graph = new StateGraph(AgentState)
    .addNode("execute", (state: AgentStateType, config) => reflexionExecuteNode(state, withNodeConfig(deps, config)))
    .addNode("tools", (state: AgentStateType) => reactToolNode(state, deps))
    .addNode("reflect", (state: AgentStateType, config) => reflexionReflectNode(state, withNodeConfig(deps, config)))
    .addConditionalEdges("execute", (state: AgentStateType) => reflexionAfterExecute(state), {
      tools: "tools",
      reflect: "reflect",
    })
    .addEdge("tools", "execute")
    .addConditionalEdges("reflect", (state: AgentStateType) => reflexionShouldContinue(state), {
      execute: "execute",
      [END]: END,
    });
  graph.addEdge(START, "execute");
  return graph;
}
