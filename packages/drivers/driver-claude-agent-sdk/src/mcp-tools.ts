/**
 * @file mcp-tools
 * @description Serves the column's Arena tools to Claude Code over in-process MCP.
 *
 * Responsibilities:
 * - Expose every registry tool as an SDK MCP tool (JSON Schema → zod raw shape)
 * - Route every call through tools.execute with the shared drift guard
 *
 * The MCP server is in-process (no port, no child), so tool calls never leave
 * the host: authorization, file-diff side channels and RAG invalidation stay on
 * the same guarded path every other column uses.
 */

import type { ToolDefinition, ToolExecutionResult } from "@agentprism/contracts";
import { sanitizeErrorMessage } from "@agentprism/contracts";
import { deriveToolZodRawShape, normalizeToolCallArgs } from "@agentprism/driver-run-support";
import { blockedToolMessageContent, type ToolAccess } from "@agentprism/harness";
import { createSdkMcpServer, tool as sdkTool } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** MCP server name; tool ids become `mcp__<ARENA_MCP_SERVER_NAME>__<tool>`. */
export const ARENA_MCP_SERVER_NAME = "arena";

export interface McpToolBridgeOptions {
  /** Task text the drift guard anchors on. */
  question: string;
  /** Harness level; "bare" disables the drift guard (matches the other columns). */
  harness: string;
  signal?: AbortSignal;
  /** Fired after every execute with the outcome (fileDiff rides here). */
  onOutcome?: (name: string, outcome: ToolExecutionResult) => void;
}

/** Per-call context shared by every tool of one column run. */
export interface ArenaToolCallOptions extends McpToolBridgeOptions {
  /** Tool names already dispatched in this run, for the drift guard. */
  priorToolNames: string[];
}

/** Claude Code tool id for one of this server's tools. */
export function mcpToolId(toolName: string): string {
  return `mcp__${ARENA_MCP_SERVER_NAME}__${toolName}`;
}

/** One text result for the model. */
function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

/**
 * Runs one Arena tool for the subprocess: drift guard, then tools.execute.
 * Exported because this is the column's tool contract (and the unit under test);
 * a thrown execute becomes error text the model can recover from instead of a
 * dead subprocess.
 */
export async function callArenaTool(
  tools: ToolAccess,
  definition: ToolDefinition,
  args: Record<string, unknown>,
  options: ArenaToolCallOptions,
): Promise<CallToolResult> {
  const blocked = blockedToolMessageContent(
    options.question,
    definition.name,
    args,
    options.priorToolNames,
    options.harness,
  );
  if (blocked !== null) return textResult(blocked);
  options.priorToolNames.push(definition.name);
  try {
    const outcome = await tools.execute(definition.name, normalizeToolCallArgs(definition, args), {
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
    options.onOutcome?.(definition.name, outcome);
    return textResult(outcome.result);
  } catch (error) {
    return textResult(`Error: tool ${definition.name} failed: ${sanitizeErrorMessage(error)}`, true);
  }
}

/**
 * Builds the in-process MCP server exposing the column's tool registry.
 * Every handler calls tools.execute, so tool work stays on the guarded path.
 */
export function createArenaMcpServer(tools: ToolAccess, options: McpToolBridgeOptions) {
  const priorToolNames: string[] = [];
  const definitions = tools.registry.listDefinitions().map((definition) =>
    sdkTool(
      definition.name,
      definition.description,
      deriveToolZodRawShape(definition),
      (args: Record<string, unknown>) => callArenaTool(tools, definition, args, { ...options, priorToolNames }),
    ),
  );
  return createSdkMcpServer({
    name: ARENA_MCP_SERVER_NAME,
    version: "0.1.0",
    tools: definitions,
  });
}

/** Tool ids to pre-approve (every Arena tool; all Claude Code built-ins stay disabled). */
export function arenaAllowedToolIds(tools: ToolAccess): string[] {
  return tools.registry.listDefinitions().map((definition) => mcpToolId(definition.name));
}
