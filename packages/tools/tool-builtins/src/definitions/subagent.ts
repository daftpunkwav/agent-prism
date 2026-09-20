/**
 * @file tools/subagent
 * @description Placeholder subagent tool: fail-closed outside live executions.
 *
 * Responsibilities:
 * - Declare the stable subagent JSON schema (single source for prompt, bridge, UI)
 * - Refuse loudly when no execution hosts it (direct registry use, unit contexts)
 *
 * The live implementation lives in the agent layer (@agentprism/agent), which
 * registers a same-named definition closing over the driver and run spec at
 * execution time (MapToolRegistry.register overwrites). This placeholder keeps
 * discovery total: the builder catalog, the LC bridge, and the prompt surface
 * see the same name and schema everywhere; only executions can answer it.
 */

import type { ToolArgs, ToolDefinition, ToolExecutionResult, ToolWorkspace } from "@agentprism/contracts";

export const SUBAGENT_TOOL_NAME = "subagent";

export const SUBAGENT_MODES = ["spawn", "fork"] as const;
export type SubagentMode = (typeof SUBAGENT_MODES)[number];

export const SUBAGENT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    task: { type: "string", description: "Self-contained subtask for the child agent (goal, scope, done criteria)" },
    max_steps: { type: "integer", description: "Child step budget, 1-10 (default 8)" },
    mode: {
      type: "string",
      description: "spawn: blank-history child (default); fork: child inherits your transcript so far",
      enum: ["spawn", "fork"],
    },
  },
  required: ["task"],
  additionalProperties: false,
};

/** Normalizes the mode arg (case-tolerant); unknown modes fail closed to spawn (never to fork: history inheritance must be explicit). */
export function normalizeSubagentMode(mode: unknown): SubagentMode {
  return typeof mode === "string" && mode.trim().toLowerCase() === "fork" ? "fork" : "spawn";
}

/** Default child step budget (bounded fan-out: delegation must stay cheaper than doing). */
export const SUBAGENT_DEFAULT_STEPS = 8;
export const SUBAGENT_MAX_STEPS = 10;

/** Placeholder execution: only a live agent run can host subagents. */
async function executeSubagentPlaceholder(
  _workspace: ToolWorkspace,
  _args: ToolArgs,
): Promise<ToolExecutionResult> {
  return {
    result: "Error: subagent is only available inside a live agent execution",
    fileDiff: null,
    ok: false,
    code: "workspace_error",
  };
}

/** Placeholder subagent tool definition (overwritten by the agent layer per execution). */
export const subagentPlaceholderTool: ToolDefinition = {
  name: SUBAGENT_TOOL_NAME,
  description:
    "Delegate a subtask to a child agent sharing your workspace and toolset (one nesting level). mode=spawn (default) starts blank-history; mode=fork inherits your transcript. The child returns its final answer as text.",
  jsonSchema: SUBAGENT_JSON_SCHEMA,
  mutatesWorkspace: true,
  execute: executeSubagentPlaceholder,
};
