/**
 * @file tools/scatter
 * @description Placeholder scatter tool: fail-closed outside live executions.
 *
 * Responsibilities:
 * - Declare the stable scatter JSON schema (single source for prompt, bridge, UI)
 * - Refuse loudly when no execution hosts it (direct registry use, unit contexts)
 *
 * The live implementation lives in the agent layer (@agentprism/agent), which
 * registers a same-named definition closing over the nested-run machinery at
 * execution time (MapToolRegistry.register overwrites). Scatter fans one task
 * list out to bounded-parallel children sharing the workspace, then joins
 * their answers (concatenated or majority-voted).
 */

import type { ToolArgs, ToolDefinition, ToolExecutionResult, ToolWorkspace } from "@agentprism/contracts";

export const SCATTER_TOOL_NAME = "scatter";

export const SCATTER_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      description: "Independent subtasks for child agents (2-8 items, each goal plus done criteria)",
      items: { type: "string" },
    },
    max_steps: { type: "integer", description: "Per-child step budget, 1-10 (default 8)" },
    mode: {
      type: "string",
      description: "spawn: blank-history children (default); fork: children inherit your transcript",
      enum: ["spawn", "fork"],
    },
    strategy: {
      type: "string",
      description: "concat: join per-task answers (default); vote: majority exact-match answer with counts",
      enum: ["concat", "vote"],
    },
  },
  required: ["tasks"],
  additionalProperties: false,
};

/** Default per-child step budget. */
export const SCATTER_DEFAULT_STEPS = 8;
/** Hard per-child step ceiling (mirrors the subagent ceiling). */
export const SCATTER_MAX_STEPS = 10;
/** Task list bounds (a scatter of one is a subagent; unbounded fan-out is a fork bomb). */
export const SCATTER_MIN_TASKS = 2;
export const SCATTER_MAX_TASKS = 8;
/** Max children running concurrently (shared workspace stays writable). */
export const SCATTER_MAX_CONCURRENCY = 3;

/** Placeholder execution: only a live agent run can host scatter. */
async function executeScatterPlaceholder(
  _workspace: ToolWorkspace,
  _args: ToolArgs,
): Promise<ToolExecutionResult> {
  return {
    result: "Error: scatter is only available inside a live agent execution",
    fileDiff: null,
    ok: false,
    code: "workspace_error",
  };
}

/** Placeholder scatter tool definition (overwritten by the agent layer per execution). */
export const scatterPlaceholderTool: ToolDefinition = {
  name: SCATTER_TOOL_NAME,
  description:
    "Fan independent subtasks out to bounded-parallel child agents sharing your workspace and toolset (one nesting level), then join their answers. Children cannot delegate further.",
  jsonSchema: SCATTER_JSON_SCHEMA,
  mutatesWorkspace: true,
  execute: executeScatterPlaceholder,
};
