/**
 * @file graphs/tot
 * @description Builds the LangGraph tree-of-thought reasoning graph with real
 * branching: width independent candidate-generation calls, each scored by its
 * own tool-free call, winner by deterministic argmax (one-level branching).
 *
 * Responsibilities:
 * - Assemble per-branch generate and score nodes on the shared AgentState
 * - Select the best-scored plan without an extra model call
 *
 * Branches chain sequentially instead of fanning out concurrently so the
 * streamEvents translation keeps the one-step-start-per-LLM-call contract.
 * Depth is 1: candidate plans are generated and scored once, not re-expanded.
 */

import { SystemMessage } from "@langchain/core/messages";
import { textFromContent } from "@agentprism/contracts";
import { parseScoreVerdict, totWidth } from "@agentprism/driver-run-support";
import { END, START, StateGraph } from "@langchain/langgraph";
import { bindToolsSafe, streamToAiMessage } from "@agentprism/driver-langchain";
import { totBranchPrompt, totScorePrompt, TOT_SELECT_NO_CANDIDATES, totSelectNote } from "../prompts.js";
import {
  AgentState,
  hasToolCalls,
  llmMessages,
  stepBudgetExhausted,
  withNodeConfig,
  type AgentStateType,
  type ReasoningGraphDeps,
  type TotCandidate,
} from "./state.js";
import { reactToolNode } from "./tool-node.js";

async function totBranchNode(
  state: AgentStateType,
  deps: ReasoningGraphDeps,
  index: number,
  width: number,
): Promise<Partial<AgentStateType>> {
  const response = await streamToAiMessage(
    deps.model,
    llmMessages(state, deps, [new SystemMessage(totBranchPrompt(index, width))]),
    deps.runnableConfig,
  );
  return { messages: [response], step_count: (state.step_count ?? 0) + 1 };
}

async function totScoreNode(
  state: AgentStateType,
  deps: ReasoningGraphDeps,
  index: number,
  width: number,
): Promise<Partial<AgentStateType>> {
  const messages = state.messages ?? [];
  const plan = textFromContent(messages[messages.length - 1]?.content);
  const response = await streamToAiMessage(
    deps.model,
    llmMessages(state, deps, [new SystemMessage(totScorePrompt(index, width))]),
    deps.runnableConfig,
  );
  const candidate: TotCandidate = { plan, score: parseScoreVerdict(textFromContent(response.content)) ?? 0 };
  return {
    messages: [response],
    step_count: (state.step_count ?? 0) + 1,
    candidates: [candidate],
  };
}

/** Picks the argmax-scored candidate index (ties break to the earliest branch). */
export function selectBestCandidate(candidates: TotCandidate[]): number {
  let best = 0;
  for (let index = 1; index < candidates.length; index += 1) {
    if ((candidates[index]?.score ?? 0) > (candidates[best]?.score ?? 0)) best = index;
  }
  return best;
}

function totSelectNode(width: number) {
  return (state: AgentStateType): Partial<AgentStateType> => {
    const candidates = state.candidates ?? [];
    const best = selectBestCandidate(candidates);
    const winner = candidates[best];
    const note =
      winner === undefined
        ? TOT_SELECT_NO_CANDIDATES
        : totSelectNote(best, width, winner.score, winner.plan);
    return { messages: [new SystemMessage(note)] };
  };
}

async function totActNode(state: AgentStateType, deps: ReasoningGraphDeps): Promise<Partial<AgentStateType>> {
  const response = await streamToAiMessage(
    bindToolsSafe(deps.model, deps.lcTools),
    llmMessages(state, deps),
    deps.runnableConfig,
  );
  return { messages: [response], step_count: (state.step_count ?? 0) + 1 };
}

function totShouldContinue(state: AgentStateType): "execute" | typeof END {
  if (stepBudgetExhausted(state)) return END;
  const messages = state.messages ?? [];
  if (hasToolCalls(messages[messages.length - 1])) return "execute";
  return END;
}

/**
 * Builds the tree-of-thoughts graph: branch_1 → score_1 → … → branch_n →
 * score_n → select → act → tools loop, one node per model call.
 *
 * @param deps Shared node dependencies (model, tools, grounding, retrieval).
 * @param width Branch width; defaults to the ARENA_TOT_WIDTH knob (2-5, default 3).
 * @returns Uncompiled StateGraph; the driver compiles with the recursion limit.
 */
export function buildTotGraph(deps: ReasoningGraphDeps, width: number = totWidth()) {
  const branchCount = Math.max(1, width);
  const graph = new StateGraph(AgentState);
  let previous: typeof START | string = START;
  for (let index = 0; index < branchCount; index += 1) {
    const branchName = `branch_${index + 1}`;
    const scoreName = `score_${index + 1}`;
    graph
      .addNode(branchName, (state: AgentStateType, config) =>
        totBranchNode(state, withNodeConfig(deps, config), index, branchCount),
      )
      .addNode(scoreName, (state: AgentStateType, config) =>
        totScoreNode(state, withNodeConfig(deps, config), index, branchCount),
      )
      // Dynamic node names escape the literal-union tracker; the chain is still
      // validated at compile() time.
      .addEdge(previous as never, branchName as never)
      .addEdge(branchName as never, scoreName as never);
    previous = scoreName;
  }
  graph
    .addNode("select", totSelectNode(branchCount))
    .addNode("act", (state: AgentStateType, config) => totActNode(state, withNodeConfig(deps, config)))
    .addNode("execute", (state: AgentStateType) => reactToolNode(state, deps))
    .addEdge(previous as never, "select")
    .addEdge("select", "act")
    .addConditionalEdges("act", (state: AgentStateType) => totShouldContinue(state), {
      execute: "execute",
      [END]: END,
    })
    .addEdge("execute", "act");
  return graph;
}
