/**
 * @file servers test
 * @description Locks MCP filesystem scoping and fetch fail-closed behavior.
 */
import { describe, expect, it } from "vitest";
import type { ToolWorkspace } from "@agentprism/contracts";
import { UrlValidationError } from "@agentprism/contracts";
import { createMcpFetchTool, mcpFetchTool, mcpFsListTool, mcpFsReadTool } from "../src/servers.js";

function workspace(files: Record<string, string>): ToolWorkspace {
  return {
    name: "ws",
    root: "/tmp/ws",
    cwd: () => "/tmp/ws",
    fs: {
      readFile: (path: string) => {
        const hit = files[path];
        if (hit === undefined) throw new Error("missing");
        return hit;
      },
      listFiles: (dir: string) => (dir === "." ? Object.keys(files) : []),
    },
  } as unknown as ToolWorkspace;
}

describe("mcp filesystem server", () => {
  it("reads scoped files and rejects traversal", async () => {
    const ws = workspace({ "a.txt": "hello" });
    expect((await mcpFsReadTool.execute(ws, { path: "a.txt" })).ok).toBe(true);
    expect((await mcpFsReadTool.execute(ws, { path: "../evil" })).ok).toBe(false);
    expect((await mcpFsReadTool.execute(ws, { path: "missing.txt" })).ok).toBe(false);
  });

  it("lists directories without traversal", async () => {
    const ws = workspace({ "a.txt": "x" });
    const out = await mcpFsListTool.execute(ws, {});
    expect(out.ok).toBe(true);
    expect(out.result).toContain("a.txt");
    expect((await mcpFsListTool.execute(ws, { dir: "../x" })).ok).toBe(false);
  });
});

describe("mcp fetch server", () => {
  it("rejects non-http urls without network", async () => {
    const ws = workspace({});
    const out = await mcpFetchTool.execute(ws, { url: "file:///etc/passwd" });
    expect(out.ok).toBe(false);
    expect(out.result).toContain("http");
  });

  it("maps host-policy rejections to a loud not-allowed result", async () => {
    const tool = createMcpFetchTool({
      fetchUrl: () => Promise.reject(new UrlValidationError("url target address is not allowed")),
    });
    const out = await tool.execute(workspace({}), { url: "http://10.0.0.1/admin" });
    expect(out.ok).toBe(false);
    expect(out.result).toContain("not allowed");
  });

  it("surfaces host fetch failures and truncates via the budget", async () => {
    const tool = createMcpFetchTool({ fetchUrl: () => Promise.reject(new Error("HTTP 503 Service Unavailable")) });
    const out = await tool.execute(workspace({}), { url: "https://example.test/", max_chars: 16 });
    expect(out.ok).toBe(false);
    expect(out.result).toContain("503");
  });

  it("fails closed when no host capability was injected", async () => {
    const out = await mcpFetchTool.execute(workspace({}), { url: "https://example.test/" });
    expect(out.ok).toBe(false);
    expect(out.result).toContain("fail-closed");
  });

  it("declares a timeout so the registry arms a derived deadline signal", () => {
    expect(mcpFetchTool.timeoutMs).toBeGreaterThan(0);
  });
});
