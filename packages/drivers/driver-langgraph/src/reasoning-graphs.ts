/**
 * @file reasoning-graphs
 * @description Barrel and builder dispatch for LangGraph reasoning graphs.
 *
 * Responsibilities:
 * - Dispatch a reasoning mode to its graph builder
 */

import type { ReasoningMode } from "@agentprism/contracts";
import type { EventStreamRunnable } from "@agentprism/harness";
import { buildCotToolGraph } from "./graphs/cot-tool.js";
import { buildReactGraph } from "./graphs/react.js";
import { buildReflexionGraph } from "./graphs/reflexion.js";
import { buildTotGraph } from "./graphs/tot.js";
import type { ReasoningGraphDeps } from "./graphs/state.js";

export type { ReasoningGraphDeps } from "./graphs/state.js";

/** Structural view of an uncompiled graph: only compile() is consumed here. */
interface UncompiledReasoningGraph {
  compile(): unknown;
}

type GraphBuilder = (deps: ReasoningGraphDeps) => UncompiledReasoningGraph;

const BUILDERS: Partial<Record<ReasoningMode, GraphBuilder>> = {
  react: buildReactGraph,
  cot_tool: buildCotToolGraph,
  tot: buildTotGraph,
  reflexion: buildReflexionGraph,
};

/** Minimal compiled-graph view: only withConfig is needed to inject the recursion limit / cancellation signal. */
export interface CompiledReasoningGraph {
  withConfig(config: Record<string, unknown>): EventStreamRunnable;
}

/** Builds the compiled graph for a reasoning mode; unknown modes throw (fail-closed like every other block id). */
export function buildReasoningGraph(mode: ReasoningMode, deps: ReasoningGraphDeps): CompiledReasoningGraph {
  const builder = BUILDERS[mode];
  if (builder === undefined) {
    throw new Error(`Unknown reasoning mode "${mode}" (available: ${Object.keys(BUILDERS).join(", ")})`);
  }
  return builder(deps).compile() as unknown as CompiledReasoningGraph;
}
