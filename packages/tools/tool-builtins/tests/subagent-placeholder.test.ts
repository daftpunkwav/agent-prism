/**
 * @file subagent placeholder tests
 * @description Locks discovery total but execution fail-closed outside live runs.
 */

import { describe, expect, it } from "vitest";
import { createBuiltinToolRegistry, normalizeSubagentMode, subagentPlaceholderTool } from "@agentprism/tool-builtins";

describe("subagentPlaceholderTool", () => {
  it("is registered with the stable schema yet refuses direct execution", async () => {
    const registry = createBuiltinToolRegistry();
    expect(registry.listDefinitions().some((d) => d.name === "subagent")).toBe(true);
    const workspace = { name: "ws", root: "", cwd: () => "", fs: null };
    const out = await subagentPlaceholderTool.execute(workspace, { task: "x" });
    expect(out.ok).toBe(false);
    expect(out.result).toContain("only available inside a live agent execution");
    const viaRegistry = await registry.execute(workspace, "subagent", { task: "x" });
    expect(viaRegistry.ok).toBe(false);
  });
});

describe("normalizeSubagentMode", () => {
  it("selects fork only on explicit request", () => {
    expect(normalizeSubagentMode("fork")).toBe("fork");
    expect(normalizeSubagentMode("spawn")).toBe("spawn");
    expect(normalizeSubagentMode(undefined)).toBe("spawn");
    expect(normalizeSubagentMode("bogus")).toBe("spawn");
  });

  it("advertises the mode enum in the schema", () => {
    const schema = subagentPlaceholderTool.jsonSchema as Record<string, Record<string, unknown>>;
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect((props.mode as Record<string, unknown>).enum).toEqual(["spawn", "fork"]);
  });
});
