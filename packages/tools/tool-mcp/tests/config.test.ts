/**
 * @file config test
 * @description Locks MCP server env parsing (fail-loud, validated defaults).
 */
import { describe, expect, it } from "vitest";
import { parseMcpServersEnv } from "../src/config.js";

describe("parseMcpServersEnv", () => {
  it("returns [] for unset or blank input", () => {
    expect(parseMcpServersEnv(undefined)).toEqual([]);
    expect(parseMcpServersEnv(null)).toEqual([]);
    expect(parseMcpServersEnv("   ")).toEqual([]);
  });

  it("parses and defaults a minimal entry", () => {
    expect(parseMcpServersEnv('[{"command": "npx"}]')).toEqual([
      { command: "npx", timeoutMs: 30000 },
    ]);
  });

  it("parses full entries with allowlists", () => {
    const parsed = parseMcpServersEnv(
      '[{"command": "uvx", "args": ["mcp-server-fetch"], "env": {"K": "V"}, "timeoutMs": 5000, "tools": ["fetch"]}]',
    );
    expect(parsed).toEqual([
      { command: "uvx", args: ["mcp-server-fetch"], env: { K: "V" }, timeoutMs: 5000, tools: ["fetch"] },
    ]);
  });

  it("rejects malformed configs loudly", () => {
    for (const bad of ["nope", "{}", "[42]", '[{}]', '[{"command": ""}]', '[{"command": "x", "args": "y"}]', '[{"command": "x", "env": {"K": 1}}]', '[{"command": "x", "timeoutMs": -1}]', '[{"command": "x", "tools": [""]}]']) {
      expect(() => parseMcpServersEnv(bad), bad).toThrow();
    }
  });
});
