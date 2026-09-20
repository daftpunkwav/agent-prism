/**
 * @file bridge test
 * @description Locks MCP policy mapping and registry bridging.
 */
import { describe, expect, it } from "vitest";
import { MapToolRegistry } from "@agentprism/tool-registry";
import {
  describeMcpAttachment,
  hasMcpAttachment,
  mcpToolsForPolicy,
  registerMcpTools,
} from "../src/bridge.js";

describe("mcpToolsForPolicy", () => {
  it("off attaches nothing", () => {
    expect(mcpToolsForPolicy("off")).toEqual([]);
    expect(mcpToolsForPolicy(undefined)).toEqual([]);
    expect(mcpToolsForPolicy("bogus")).toEqual([]);
    expect(hasMcpAttachment("off")).toBe(false);
    expect(describeMcpAttachment("off")).toBe("");
  });

  it("fs attaches filesystem servers only", () => {
    expect(mcpToolsForPolicy("fs")).toEqual(["mcp__fs_list", "mcp__fs_read"]);
    expect(hasMcpAttachment("fs")).toBe(true);
    expect(describeMcpAttachment("fs")).toContain("mcp__fs_read");
  });

  it("full attaches filesystem plus fetch", () => {
    expect(mcpToolsForPolicy("full")).toEqual(["mcp__fs_list", "mcp__fs_read", "mcp__fetch_url"]);
  });
});

describe("registerMcpTools", () => {
  it("bridges wanted servers into the registry", () => {
    const registry = new MapToolRegistry();
    expect(registerMcpTools(registry, "off")).toEqual([]);
    expect(registry.listDefinitions()).toEqual([]);
    expect(registerMcpTools(registry, "fs")).toEqual(["mcp__fs_list", "mcp__fs_read"]);
    expect(registry.listDefinitions().map((d) => d.name)).toEqual(["mcp__fs_list", "mcp__fs_read"]);
  });
});
