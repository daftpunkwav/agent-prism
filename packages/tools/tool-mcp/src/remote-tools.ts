/**
 * @file tool-mcp/remote-tools
 * @description Bridges stdio MCP server tools into a ToolRegistry.
 *
 * Responsibilities:
 * - List remote tools through an McpClient and register delegating definitions
 * - Enforce server allowlists and name namespacing (`mcp__<server>__<tool>`)
 *
 * Remote names carry the server tag so traces show exactly which process
 * served each call. Registration is explicit per server (no ambient
 * discovery): the host owns server lifecycles and calls this per client.
 */

import type { ToolDefinition, ToolRegistry } from "@agentprism/contracts";
import { McpClient, McpError } from "./client.js";

/** Max remote tool name length accepted (over-long names fail registration). */
export const REMOTE_TOOL_NAME_LIMIT = 96;

/** Namespaces a remote tool under its server (`mcp__<server>__<tool>`). */
export function remoteToolName(serverTag: string, toolName: string): string {
  const tag = serverTag.trim().replace(/[^a-z0-9_-]/gi, "").slice(0, 32) || "server";
  return `mcp__${tag}__${toolName}`;
}

/**
 * Registers a connected server's tools into the registry.
 * @returns Sorted registered names. Throws McpError when listing fails.
 */
export async function registerRemoteMcpTools(
  registry: ToolRegistry,
  client: McpClient,
  serverTag: string,
  allowlist?: readonly string[],
): Promise<string[]> {
  const allowed = allowlist === undefined ? null : new Set(allowlist);
  const registered: string[] = [];
  for (const remote of await client.listTools()) {
    if (allowed !== null && !allowed.has(remote.name)) continue;
    const name = remoteToolName(serverTag, remote.name);
    if (name.length > REMOTE_TOOL_NAME_LIMIT) continue;
    const definition: ToolDefinition = {
      name,
      description: `MCP server ${serverTag}: ${remote.description || remote.name}`,
      jsonSchema: remote.inputSchema,
      mutatesWorkspace: false,
      execute: async (_workspace, args, signal) => {
        if (signal?.aborted) {
          return { result: "Error: aborted", fileDiff: null, ok: false, code: "aborted" };
        }
        try {
          const result = await client.callTool(remote.name, args);
          return { result, fileDiff: null, ok: true };
        } catch (error) {
          if (error instanceof McpError) {
            return { result: `Error: ${error.message}`, fileDiff: null, ok: false, code: "workspace_error" };
          }
          throw error;
        }
      },
    };
    registry.register(definition);
    registered.push(name);
  }
  return registered.sort();
}
