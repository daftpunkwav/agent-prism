/**
 * @file tool-mcp package barrel
 * @description Public exports for the MCP attachment package.
 *
 * Responsibilities:
 * - Re-export MCP servers, policy tables, and registry bridging
 */

export * from "./servers.js";
export * from "./bridge.js";
export * from "./transport.js";
export * from "./client.js";
export * from "./remote-tools.js";
export * from "./config.js";
export {
  McpServersStore,
  McpStoreError,
  type McpStoreFile,
  type McpStoreCodec,
} from "./mcp-servers-store.js";
