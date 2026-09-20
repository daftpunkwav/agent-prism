/**
 * @file tool-registry leaf tests
 * @description Locks the registry seam in isolation: validation, selection, toolset resolution.
 */

import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "@agentprism/contracts";
import { MapToolRegistry, normalizeToolset, resolveToolsetId, selectToolNames, selectToolRegistry } from "../src/index.js";

function stubTool(name: string): ToolDefinition {
  return {
    name,
    description: `stub ${name}`,
    jsonSchema: { type: "object" },
    mutatesWorkspace: false,
    execute: async () => ({ result: "ok", fileDiff: null, ok: true }),
  };
}

describe("MapToolRegistry", () => {
  it("rejects blank names and non-positive timeouts at registration", () => {
    const registry = new MapToolRegistry();
    expect(() => registry.register(stubTool("  "))).toThrow(/non-empty/);
    expect(() => registry.register({ ...stubTool("read"), timeoutMs: 0 })).toThrow(/timeoutMs/);
    expect(() => registry.register({ ...stubTool("read"), timeoutMs: Number.NaN })).toThrow(/timeoutMs/);
  });

  it("lists definitions sorted by name and selects subsets by name", () => {
    const registry = new MapToolRegistry();
    registry.register(stubTool("write"));
    registry.register(stubTool("read"));
    registry.register(stubTool("grep"));
    expect(registry.listDefinitions().map((definition) => definition.name)).toEqual(["grep", "read", "write"]);

    const subset = registry.select(["read", "missing"]);
    expect(subset.authorizedNames()).toEqual(new Set(["read"]));
    expect(subset.listDefinitions().map((definition) => definition.name)).toEqual(["read"]);
  });
});

describe("toolset resolution", () => {
  it("resolves legacy aliases; unknown values fail-closed to read_only", () => {
    expect(resolveToolsetId("code_file")).toBe("edit_run");
    expect(resolveToolsetId("calc_time")).toBe("read_only");
    expect(resolveToolsetId("")).toBe("full");
    expect(resolveToolsetId("nonsense")).toBe("read_only");
    expect(normalizeToolset("nonsense")).toBe("read_only");
  });

  it("selects tool names per resolved toolset", () => {
    const names = selectToolNames("read_only");
    expect(names.length).toBeGreaterThan(0);
    expect(names).not.toContain("write");
    // Legacy alias resolves to the same set as its canonical id.
    expect(selectToolNames("code_file")).toEqual(selectToolNames("edit_run"));
  });

  it("selectToolRegistry keeps only authorized entries", () => {
    const registry = new MapToolRegistry();
    registry.register(stubTool("read"));
    registry.register(stubTool("write"));
    const selected = selectToolRegistry(registry, "read_only");
    const names = [...selected.authorizedNames()];
    expect(names).toContain("read");
    expect(names).not.toContain("write");
  });
});
