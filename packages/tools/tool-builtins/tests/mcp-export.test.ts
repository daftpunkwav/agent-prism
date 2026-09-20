/**
 * @file mcp-export tests
 * @description Verifies all 22 builtin tools export to compliant MCP schemas.
 */

import { describe, expect, it } from "vitest";
import { McpToolSchema } from "@agentprism/contracts";
import { exportRegistryToMcp } from "@agentprism/tool-registry";
import { createBuiltinToolRegistry } from "../src/builtins.js";

describe("builtin MCP export", () => {
  it("exports 22 builtins as valid, uniquely-named McpTools", () => {
    const registry = createBuiltinToolRegistry();
    expect(registry.listDefinitions()).toHaveLength(22);
    const exported = exportRegistryToMcp(registry);
    expect(exported).toHaveLength(22);
    for (const tool of exported) {
      expect(() => McpToolSchema.parse(tool)).not.toThrow();
    }
    const names = exported.map((t) => t.name);
    expect(new Set(names).size).toBe(22);
    expect([...names].sort()).toEqual(names);
  });
});
