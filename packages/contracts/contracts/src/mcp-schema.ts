/**
 * @file mcp-schema
 * @description Standardized Model Context Protocol (MCP) data contracts.
 *
 * Responsibilities:
 * - Define standard Zod schemas and TypeScript types for MCP Tools, Resources, and Prompts
 * - Align internal tool definitions with the official 2024-2026 MCP specification
 *
 * Contracts-layer module: pure schemas and ports, zero internal @agentprism/* dependencies.
 */

import { z } from "zod";

/** Standard JSON Schema object for tool parameters. */
export const McpToolInputSchema = z.record(z.string(), z.unknown());

/** Standard MCP Tool specification (compatible with Anthropic/MCP 2024-11+ wire format). */
export const McpToolSchema = z.object({
  name: z.string().min(1).max(96),
  description: z.string().default(""),
  inputSchema: McpToolInputSchema,
});
export type McpTool = z.infer<typeof McpToolSchema>;

/** Standard MCP Resource metadata. */
export const McpResourceSchema = z.object({
  uri: z.string().url().or(z.string().min(1)),
  name: z.string().min(1),
  description: z.string().optional(),
  mimeType: z.string().optional(),
});
export type McpResource = z.infer<typeof McpResourceSchema>;

/** Content item read from an MCP Resource. */
export const McpResourceContentSchema = z.object({
  uri: z.string(),
  mimeType: z.string().optional(),
  text: z.string().optional(),
  blob: z.string().optional(),
});
export type McpResourceContent = z.infer<typeof McpResourceContentSchema>;

/** Standard MCP Prompt argument definition. */
export const McpPromptArgumentSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  required: z.boolean().default(false),
});
export type McpPromptArgument = z.infer<typeof McpPromptArgumentSchema>;

/** Standard MCP Prompt template definition. */
export const McpPromptSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  arguments: z.array(McpPromptArgumentSchema).default([]),
});
export type McpPrompt = z.infer<typeof McpPromptSchema>;
