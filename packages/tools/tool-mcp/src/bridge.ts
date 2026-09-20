/**
 * @file tool-mcp/bridge
 * @description MCP policy selection and registry bridging.
 *
 * Responsibilities:
 * - Map McpPolicy values to server tool lists
 * - Register MCP tools into a ToolRegistry without touching builtins
 * - Describe the attachment for prompt grounding and banners
 */

import type { McpPolicy, ToolRegistry } from "@agentprism/contracts";
import { mcpServerTools, type McpFetchDeps } from "./servers.js";

/** MCP tool names attached by each policy (sorted for stability). */
export const MCP_TOOLS_BY_POLICY: Record<McpPolicy, readonly string[]> = {
  off: [],
  fs: ["mcp__fs_list", "mcp__fs_read"],
  full: ["mcp__fs_list", "mcp__fs_read", "mcp__fetch_url"],
};

/** Tool names attached by an MCP policy (unknown policies fail closed to off). */
export function mcpToolsForPolicy(policy: string | null | undefined): string[] {
  if (policy === "fs") return [...MCP_TOOLS_BY_POLICY.fs];
  if (policy === "full") return [...MCP_TOOLS_BY_POLICY.full];
  return [];
}

/** Whether an MCP policy attaches any server tools. */
export function hasMcpAttachment(policy: string | null | undefined): boolean {
  return mcpToolsForPolicy(policy).length > 0;
}

/** One-line prompt grounding describing the MCP attachment (empty when off). */
export function describeMcpAttachment(policy: string | null | undefined): string {
  const names = mcpToolsForPolicy(policy);
  if (names.length === 0) return "";
  return `[MCP: ${names.join(", ")} bridged from in-process capability servers]`;
}

/**
 * Registers MCP server tools for a policy into a registry.
 * Idempotent per name: re-registering overwrites the same definition.
 *
 * @returns Sorted names actually registered.
 */
export function registerMcpTools(
  registry: ToolRegistry,
  policy: string | null | undefined,
  deps?: Partial<McpFetchDeps>,
): string[] {
  const wanted = new Set(mcpToolsForPolicy(policy));
  if (wanted.size === 0) return [];
  const registered: string[] = [];
  for (const server of Object.values(mcpServerTools(deps))) {
    for (const definition of server) {
      if (wanted.has(definition.name)) {
        registry.register(definition);
        registered.push(definition.name);
      }
    }
  }
  return registered.sort();
}
