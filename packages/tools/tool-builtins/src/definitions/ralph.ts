/**
 * @file tools/ralph
 * @description Placeholder ralph_loop tool: fail-closed outside live executions.
 *
 * Responsibilities:
 * - Declare the stable ralph_loop JSON schema (single source for prompt, bridge, UI)
 * - Refuse loudly when no execution hosts it (direct registry use, unit contexts)
 *
 * The live implementation lives in the agent layer (@agentprism/agent), which
 * registers a same-named definition closing over the run spec at execution time
 * (MapToolRegistry.register overwrites) — the same placeholder/live split as
 * subagent. Rounds are fresh sibling runs, never nested deeper.
 */

import type { ToolArgs, ToolDefinition, ToolExecutionResult, ToolWorkspace } from "@agentprism/contracts";

export const RALPH_TOOL_NAME = "ralph_loop";

export const RALPH_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    objective: { type: "string", description: "The single objective every round serves" },
    max_rounds: { type: "integer", description: "Round budget, 1-8 (default 3)" },
  },
  required: ["objective"],
  additionalProperties: false,
};

/** Default round budget (bounded fan-out: loops must stay cheaper than wandering). */
export const RALPH_DEFAULT_ROUNDS = 3;
export const RALPH_MAX_ROUNDS = 8;
/** Handoff cap between rounds (prior summary carried forward, truncated). */
export const RALPH_HANDOFF_CHARS = 4000;

/** Placeholder execution: only a live agent run can host ralph rounds. */
async function executeRalphPlaceholder(
  _workspace: ToolWorkspace,
  _args: ToolArgs,
): Promise<ToolExecutionResult> {
  return {
    result: "Error: ralph_loop is only available inside a live agent execution",
    fileDiff: null,
    ok: false,
    code: "workspace_error",
  };
}

/** Placeholder ralph_loop tool definition (overwritten by the agent layer per execution). */
export const ralphPlaceholderTool: ToolDefinition = {
  name: RALPH_TOOL_NAME,
  description:
    "Iterate toward one objective in fresh-child rounds with bounded handoffs. Each round ends with STATUS (continue/complete/blocked) plus SUMMARY; the loop stops on complete, blocked, or round budget.",
  jsonSchema: RALPH_JSON_SCHEMA,
  mutatesWorkspace: true,
  execute: executeRalphPlaceholder,
};
