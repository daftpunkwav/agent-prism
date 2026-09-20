/**
 * @file ralph_loop placeholder tests
 * @description Locks discovery total but execution fail-closed outside live runs.
 */

import { describe, expect, it } from "vitest";
import { createBuiltinToolRegistry, ralphPlaceholderTool } from "@agentprism/tool-builtins";

describe("ralphPlaceholderTool", () => {
  it("is registered with the stable schema yet refuses direct execution", async () => {
    const registry = createBuiltinToolRegistry();
    expect(registry.listDefinitions().some((d) => d.name === "ralph_loop")).toBe(true);
    const workspace = { name: "ws", root: "", cwd: () => "", fs: null };
    const out = await ralphPlaceholderTool.execute(workspace, { objective: "x" });
    expect(out.ok).toBe(false);
    expect(out.result).toContain("only available inside a live agent execution");
    const viaRegistry = await registry.execute(workspace, "ralph_loop", { objective: "x" });
    expect(viaRegistry.ok).toBe(false);
  });
});
