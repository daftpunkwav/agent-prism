/**
 * @file tools/session-query
 * @description Placeholder session_query tool: fail-closed outside live executions.
 *
 * Responsibilities:
 * - Declare the stable session_query JSON schema (single source for prompt, bridge, UI)
 * - Refuse loudly when no execution hosts it (direct registry use, unit contexts)
 *
 * The live implementation lives in the agent layer (@agentprism/agent), which
 * registers a same-named definition closing over the injected SessionQueryPort
 * at execution time (MapToolRegistry.register overwrites). Read-only: safe in
 * every toolset, including read_only.
 */

import type { ToolArgs, ToolDefinition, ToolExecutionResult, ToolWorkspace } from "@agentprism/contracts";

export const SESSION_QUERY_TOOL_NAME = "session_query";

export const SESSION_QUERY_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    action: { type: "string", description: "list recent sessions, read one session with entries, or read_entry for one spilled blob entry" },
    seq: { type: "number", description: "Entry seq for read_entry (from the read listing)" },
    offset: { type: "number", description: "First blob line for read_entry (1-based, default 1)" },
    id: { type: "string", description: "Session id for read (list needs none)" },
    limit: { type: "number", description: "Max rows/entries returned (default 10, cap 50)" },
  },
  required: ["action"],
  additionalProperties: false,
};

/** Default row/entry cap for list and read. */
export const SESSION_QUERY_DEFAULT_LIMIT = 10;
/** Hard cap per call (keeps ledger reads out of the context budget). */
export const SESSION_QUERY_MAX_LIMIT = 50;

/** Placeholder execution: only a live agent run can host session queries. */
async function executeSessionQueryPlaceholder(
  _workspace: ToolWorkspace,
  _args: ToolArgs,
): Promise<ToolExecutionResult> {
  return {
    result: "Error: session_query is only available inside a live agent execution",
    fileDiff: null,
    ok: false,
    code: "workspace_error",
  };
}

/** Placeholder session_query tool definition (overwritten by the agent layer per execution). */
export const sessionQueryPlaceholderTool: ToolDefinition = {
  name: SESSION_QUERY_TOOL_NAME,
  description:
    "Query past execution sessions: list recent runs, read one session's record plus milestone entries, or read_entry for the full text of a spilled blob entry. Read-only; use it to consult prior runs in follow-up turns.",
  jsonSchema: SESSION_QUERY_JSON_SCHEMA,
  mutatesWorkspace: false,
  execute: executeSessionQueryPlaceholder,
};
