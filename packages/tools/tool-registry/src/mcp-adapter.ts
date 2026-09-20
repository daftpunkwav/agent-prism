/**
 * @file mcp-adapter
 * @description Adapts internal ToolDefinition and ToolRegistry into standard MCP Tool schemas.
 *
 * Responsibilities:
 * - Convert internal ToolDefinition into standard McpTool format
 * - Batch export registered tools into an array of McpTool specifications
 *
 * Pure adapter: depends only on @agentprism/contracts.
 */

import type { McpTool, ToolDefinition, ToolRegistry } from "@agentprism/contracts";

/**
 * Converts a single internal ToolDefinition to an official MCP Tool schema.
 */
export function toMcpTool(definition: ToolDefinition): McpTool {
  const inputSchema =
    definition.jsonSchema && typeof definition.jsonSchema === "object" && !Array.isArray(definition.jsonSchema)
      ? (definition.jsonSchema as Record<string, unknown>)
      : { type: "object", properties: {} };

  return {
    name: definition.name,
    description: definition.description,
    inputSchema,
  };
}

/**
 * Exports all registered tools in a ToolRegistry to standard MCP Tool schemas (sorted by name).
 */
export function exportRegistryToMcp(registry: ToolRegistry): McpTool[] {
  return registry
    .listDefinitions()
    .map(toMcpTool)
    .sort((a, b) => a.name.localeCompare(b.name));
}
