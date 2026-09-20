/**
 * @file tool-registry package barrel
 * @description Public exports for the tool-registry package.
 *
 * Responsibilities:
 * - Re-export the ToolRegistry seam and the toolset-resolution helpers
 *
 * Implementation-free: ships no tool; backends register through this seam.
 */

export * from "./registry.js";
export * from "./toolset.js";
export * from "./mcp-adapter.js";
