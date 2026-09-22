/**
 * @file mcp-servers-store tests
 * @description Locks the managed MCP registry: env seeding, validation, replace roundtrip, hot-apply identity.
 */
import { describe, expect, it } from "vitest";
import { McpServersStore, McpStoreError } from "../src/mcp-servers-store.js";
import type { McpServerConfig } from "../src/client.js";

/** In-memory store file. */
function memoryFile(initial: { value: unknown } = { value: undefined }) {
  return {
    exists: () => initial.value !== undefined,
    read: () => initial.value,
    write: (value: unknown) => {
      initial.value = value;
    },
  };
}

describe("McpServersStore", () => {
  it("seeds from the env list when no store file exists and persists the first save", () => {
    const file = memoryFile();
    const seed: McpServerConfig[] = [{ command: "npx", args: ["-y", "server-thing"], timeoutMs: 30_000 }];
    const store = new McpServersStore({ file, seed });
    expect(store.servers).toHaveLength(1);
    expect(store.servers[0]?.command).toBe("npx");
    // The env seed is NOT written until an explicit save: env-only behavior is preserved.
    expect(file.exists()).toBe(false);
    store.replace([{ command: "node", args: ["mcp.js"], name: "local", enabled: true }]);
    expect(file.exists()).toBe(true);
    expect(store.servers[0]?.name).toBe("local");
  });

  it("loads an existing store file over the seed", () => {
    const file = memoryFile();
    file.write([{ command: "deno", args: ["run", "mcp.ts"], name: "deno-mcp", enabled: false }]);
    const store = new McpServersStore({ file, seed: [{ command: "ignored" }] });
    expect(store.servers).toHaveLength(1);
    expect(store.servers[0]?.command).toBe("deno");
    expect(store.servers[0]?.enabled).toBe(false);
  });

  it("replace validates through the shared parser and throws McpStoreError on defect", () => {
    const file = memoryFile();
    const store = new McpServersStore({ file, seed: [] });
    expect(() => store.replace([{ command: "" }])).toThrow(McpStoreError);
    // The failed save must not corrupt the in-memory list.
    expect(store.servers).toHaveLength(0);
    store.replace([{ command: "ok", timeoutMs: 1_000 }]);
    expect(store.servers[0]?.timeoutMs).toBe(1_000);
  });

  it("replace rejects duplicate identities (explicit name, else command)", () => {
    const file = memoryFile();
    const store = new McpServersStore({ file, seed: [] });
    expect(() =>
      store.replace([
        { command: "node", name: "dup" },
        { command: "deno", name: "dup" },
      ]),
    ).toThrow(/duplicate MCP server identity "dup"/);
    expect(() =>
      store.replace([
        { command: "same" },
        { command: "same" },
      ]),
    ).toThrow(/duplicate MCP server identity "same"/);
    // Distinct commands without names stay valid.
    expect(() =>
      store.replace([
        { command: "a" },
        { command: "b" },
      ]),
    ).not.toThrow();
  });

  it("a failed write leaves the shared list untouched (persist before hot-apply)", () => {
    const store = new McpServersStore({
      file: {
        exists: () => false,
        read: () => undefined,
        write: () => {
          throw new Error("disk full");
        },
      },
      seed: [{ command: "kept" }],
    });
    expect(() => store.replace([{ command: "next" }])).toThrow("disk full");
    expect(store.servers.map((server) => server.command)).toEqual(["kept"]);
  });

  it("keeps the shared array identity so per-run consumers hot-reload", () => {
    const file = memoryFile();
    const store = new McpServersStore({ file, seed: [{ command: "first" }] });
    const reference = store.servers;
    store.replace([{ command: "second" }]);
    expect(reference).toBe(store.servers);
    expect(reference[0]?.command).toBe("second");
  });

  it("falls back to the seed when the store file is corrupt", () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      const file = {
        exists: () => true,
        read: () => "{ not json",
        write: () => {},
      };
      const store = new McpServersStore({ file, seed: [{ command: "seeded" }] });
      expect(store.servers.map((server) => server.command)).toEqual(["seeded"]);
    } finally {
      console.warn = warn;
    }
  });
});
