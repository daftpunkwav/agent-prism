/**
 * @file mcp-adapter tests
 * @description Verifies transformation of internal tools into standard MCP schemas.
 */

import { describe, expect, it } from "vitest";
import { McpToolSchema, type ToolDefinition } from "@agentprism/contracts";
import { MapToolRegistry } from "../src/registry.js";
import { exportRegistryToMcp, toMcpTool } from "../src/mcp-adapter.js";

describe("toMcpTool", () => {
  it("converts a ToolDefinition to a valid McpTool conforming to the Zod schema", () => {
    const internalTool: ToolDefinition = {
      name: "calculate_sum",
      description: "Computes sum of two numbers",
      jsonSchema: {
        type: "object",
        properties: {
          a: { type: "number" },
          b: { type: "number" },
        },
        required: ["a", "b"],
      },
      mutatesWorkspace: false,
      execute: async () => ({ result: "3", fileDiff: null, ok: true }),
    };

    const mcpTool = toMcpTool(internalTool);

    expect(mcpTool.name).toBe("calculate_sum");
    expect(mcpTool.description).toBe("Computes sum of two numbers");
    expect(mcpTool.inputSchema).toEqual(internalTool.jsonSchema);
    expect(() => McpToolSchema.parse(mcpTool)).not.toThrow();
  });

  it("handles missing or empty jsonSchema gracefully", () => {
    const internalTool: ToolDefinition = {
      name: "noop",
      description: "Does nothing",
      jsonSchema: undefined as unknown as Record<string, unknown>,
      mutatesWorkspace: false,
      execute: async () => ({ result: "", fileDiff: null, ok: true }),
    };

    const mcpTool = toMcpTool(internalTool);
    expect(mcpTool.inputSchema).toEqual({ type: "object", properties: {} });
    expect(() => McpToolSchema.parse(mcpTool)).not.toThrow();
  });
});

describe("exportRegistryToMcp", () => {
  it("exports and sorts all definitions from a tool registry", () => {
    const registry = new MapToolRegistry();
    registry.register({
      name: "zeta_tool",
      description: "Zeta",
      jsonSchema: { type: "object" },
      mutatesWorkspace: false,
      execute: async () => ({ result: "", fileDiff: null, ok: true }),
    });
    registry.register({
      name: "alpha_tool",
      description: "Alpha",
      jsonSchema: { type: "object" },
      mutatesWorkspace: false,
      execute: async () => ({ result: "", fileDiff: null, ok: true }),
    });

    const exported = exportRegistryToMcp(registry);
    expect(exported).toHaveLength(2);
    expect(exported[0]?.name).toBe("alpha_tool");
    expect(exported[1]?.name).toBe("zeta_tool");
    expect(() => exported.forEach((t) => McpToolSchema.parse(t))).not.toThrow();
  });
});
