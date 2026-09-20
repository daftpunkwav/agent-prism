/**
 * @file agent-driver
 * @description Port for agent execution backends.
 *
 * Responsibilities:
 * - Define the run entry every driver backend implements
 *
 * Pure interface: no framework or IO dependencies; contracts deliberately
 * avoid LangChain/Workspace imports. The context parameter stays `| unknown`
 * because drivers receive the harness-owned execution context (which contracts
 * cannot import without creating a dependency cycle); AgentRunContext is the
 * legacy structural description of that context, kept exported for compatibility.
 */

import type { ArenaEvent } from "./events.js";
import type { AgentRunContext } from "./agent-run-context.js";

export interface AgentDriver {
  readonly frameworkId: string;
  readonly displayName: string;
  /**
   * Runs one column. Implementations receive the harness execution context
   * (identity, config, workspace, llm, tools, signal); the `| unknown` keeps
   * this port free of the harness dependency.
   */
  run(context: AgentRunContext | unknown): AsyncIterable<ArenaEvent>;
}
