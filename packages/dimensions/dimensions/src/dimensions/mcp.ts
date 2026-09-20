/**
 * @file dimensions/mcp
 * @description Static options for the MCP attachment dimension.
 *
 * Responsibilities:
 * - Export MCP_OPTIONS consumed by the dimension catalog
 */

import type { DimensionOptionTriple } from "../fields.js";

export const MCP_OPTIONS: DimensionOptionTriple[] = [
  { field: "mcp_policy", value: "off", label: "MCP off (builtins only)" },
  { field: "mcp_policy", value: "fs", label: "MCP filesystem server" },
  { field: "mcp_policy", value: "full", label: "MCP filesystem + fetch" },
];
