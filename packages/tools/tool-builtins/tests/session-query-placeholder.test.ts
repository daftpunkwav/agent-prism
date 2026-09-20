/**
 * @file session-query placeholder tests
 * @description Locks discovery plus fail-closed execution outside live runs.
 */
import { describe, expect, it } from "vitest";
import {
  createBuiltinToolRegistry,
  SESSION_QUERY_JSON_SCHEMA,
  sessionQueryPlaceholderTool,
} from "@agentprism/tool-builtins";

describe("sessionQueryPlaceholderTool", () => {
  it("is registered read-only with a stable schema yet refuses direct execution", async () => {
    const registry = createBuiltinToolRegistry();
    expect(registry.listDefinitions().some((d) => d.name === "session_query")).toBe(true);
    expect(sessionQueryPlaceholderTool.mutatesWorkspace).toBe(false);
    expect(SESSION_QUERY_JSON_SCHEMA.required).toEqual(["action"]);
    const workspace = { name: "ws", root: "", cwd: () => "", fs: null };
    const out = await sessionQueryPlaceholderTool.execute(workspace, { action: "list" });
    expect(out.ok).toBe(false);
    expect(out.result).toContain("only available inside a live agent execution");
  });
});
