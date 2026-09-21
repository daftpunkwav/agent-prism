/**
 * @file tool-mcp/config
 * @description MCP server configuration parsing for operator-supplied servers.
 *
 * Responsibilities:
 * - Parse the `MCP_SERVERS` env JSON into validated server configs
 * - Fail loudly on malformed entries (never half-configure a process spawn)
 *
 * Expected shape: a JSON array of `{command, args?, env?, timeoutMs?, tools?}`.
 * An unset or blank variable means no external servers (in-process servers and
 * the mcp dimension are unaffected). Spawning happens in the agent layer, not
 * here: this module only validates.
 */

import { MCP_DEFAULT_TIMEOUT_MS, type McpServerConfig } from "./client.js";

function isStringRecord(value: unknown): value is Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => typeof entry === "string");
}

/**
 * Parses MCP server configs from env JSON (throws McpParseError on defects).
 * Returns [] for unset/blank input.
 */
export function parseMcpServersEnv(
  raw: string | undefined | null,
  options: { defaultTimeoutMs?: number } = {},
): McpServerConfig[] {
  if (raw === undefined || raw === null || raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("MCP_SERVERS is not valid JSON (expected an array of server configs)");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("MCP_SERVERS must be a JSON array of server configs");
  }
  return parsed.map((entry, index) => parseOne(entry, index, options));
}

function parseOne(entry: unknown, index: number, options: { defaultTimeoutMs?: number }): McpServerConfig {
  const where = `MCP_SERVERS[${index}]`;
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`${where} must be an object with a command string`);
  }
  const record = entry as Record<string, unknown>;
  if (typeof record.command !== "string" || record.command.trim() === "") {
    throw new Error(`${where}.command must be a non-empty string`);
  }
  const config: McpServerConfig = { command: (record.command as string).trim() };
  if (record.args !== undefined) {
    if (!Array.isArray(record.args) || !record.args.every((arg) => typeof arg === "string")) {
      throw new Error(`${where}.args must be a string array`);
    }
    config.args = [...(record.args as string[])];
  }
  if (record.env !== undefined) {
    if (!isStringRecord(record.env)) throw new Error(`${where}.env must be a string-to-string map`);
    config.env = { ...(record.env as Record<string, string>) };
  }
  if (record.timeoutMs !== undefined) {
    if (typeof record.timeoutMs !== "number" || !Number.isFinite(record.timeoutMs) || record.timeoutMs <= 0) {
      throw new Error(`${where}.timeoutMs must be a positive number`);
    }
    config.timeoutMs = Math.floor(record.timeoutMs);
  } else {
    config.timeoutMs = options.defaultTimeoutMs ?? MCP_DEFAULT_TIMEOUT_MS;
  }
  if (record.tools !== undefined) {
    if (!Array.isArray(record.tools) || !record.tools.every((tool) => typeof tool === "string" && tool !== "")) {
      throw new Error(`${where}.tools must be a non-empty-string array`);
    }
    config.tools = [...(record.tools as string[])];
  }
  if (record.name !== undefined) {
    if (typeof record.name !== "string" || record.name.trim() === "") {
      throw new Error(`${where}.name must be a non-empty string when present`);
    }
    config.name = record.name.trim();
  }
  if (record.enabled !== undefined) {
    if (typeof record.enabled !== "boolean") throw new Error(`${where}.enabled must be a boolean when present`);
    config.enabled = record.enabled;
  }
  return config;
}
