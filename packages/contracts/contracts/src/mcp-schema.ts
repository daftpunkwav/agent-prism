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

/**
 * Wire row of the managed MCP server list (`servers` entries of
 * GET/PUT /api/settings/mcp). Read-only projection of the runtime server
 * config: the transport controller seam and the browser client bind this
 * shape, while the store keeps its own (structurally identical) type —
 * contracts stays the shared vocabulary so neither side can drift.
 */
export interface McpServerConfigView {
  /** Spawn command (non-empty; identity fallback when no explicit name is set). */
  command: string;
  /** argv for the spawned server process. */
  readonly args?: readonly string[];
  /** Baseline-env additions for the child process (string-to-string only). */
  readonly env?: Readonly<Record<string, string>>;
  /** Per-request timeout in ms (default 30s). */
  readonly timeoutMs?: number;
  /** Allowlisted remote tool names (default: all). */
  readonly tools?: readonly string[];
  /** Settings-view display name (defaults to the command basename). */
  readonly name?: string;
  /** Disabled servers persist but never attach to runs (default true). */
  readonly enabled?: boolean;
}

/**
 * Validation error of the managed MCP server store (an invalid server list).
 * Lives here so the transport leaf that maps it to 400 can use `instanceof`
 * with no package edge to tool-mcp (same pattern as UrlValidationError); the
 * name stays "McpStoreError" so logs and operator-facing traces keep their
 * shape. Persistence failures (disk, permissions) are plain errors and must
 * not carry this identity — routes rethrow them to the shell's 5xx mapping.
 */
export class McpStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpStoreError";
  }
}
