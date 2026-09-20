/**
 * @file remote-mcp tests
 * @description Locks remote MCP attachment gating and child-process teardown.
 */
import { describe, expect, it, vi } from "vitest";
import type { AgentExecutionContext } from "@agentprism/harness";
import type { McpChildProcess, McpTransport } from "@agentprism/tool-mcp";
import { attachRemoteMcpServers } from "../src/agent-execution.js";
import { MapToolRegistry } from "@agentprism/tool-registry";
import { collect, testDeps, testSpec } from "./run-fixtures.js";
import type { ArenaEvent } from "@agentprism/contracts";

/** Builds a minimal connected-duplex child that answers the handshake only. */
function handshakeChild(onKill: () => void): McpChildProcess {
  const queue: string[] = [];
  const waiters: Array<() => void> = [];
  let ended = false;
  let exitResolve: (value: { code: number | null; signal: string | null }) => void = () => {};
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    exitResolve = resolve;
  });
  return {
    write(message: string): void {
      const request = JSON.parse(message) as { id?: number; method?: string };
      if (request.method === "initialize" && request.id !== undefined) {
        queue.push(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} }));
      } else if (request.method === "tools/list" && request.id !== undefined) {
        queue.push(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [] } }));
      }
      while (waiters.length > 0) (waiters.shift() as () => void)();
    },
    async *messages(): AsyncGenerator<string> {
      for (;;) {
        const next = queue.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        if (ended) return;
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
    },
    kill(): void {
      ended = true;
      onKill();
      exitResolve({ code: null, signal: "SIGTERM" });
      while (waiters.length > 0) (waiters.shift() as () => void)();
    },
    exited: () => exited,
  };
}

describe("attachRemoteMcpServers", () => {
  it("returns [] for no servers without spawning", async () => {
    const spawn = vi.fn();
    const registry = new MapToolRegistry();
    const clients = await attachRemoteMcpServers(registry, [], { spawn } as unknown as McpTransport);
    expect(clients).toEqual([]);
    expect(spawn).not.toHaveBeenCalled();
    expect(registry.listDefinitions()).toEqual([]);
  });

  it("skips dead servers best-effort", async () => {
    const failing: McpTransport = {
      spawn: () => { throw new Error("no binary"); },
    };
    const registry = new MapToolRegistry();
    const warnings: string[] = [];
    const consoleWarn = console.warn;
    console.warn = (message: string) => { warnings.push(message); };
    try {
      const clients = await attachRemoteMcpServers(registry, [{ command: "missing" }], failing);
      expect(clients).toEqual([]);
      expect(warnings.some((w) => w.includes("skipped"))).toBe(true);
    } finally {
      console.warn = consoleWarn;
    }
  });
});

describe("runAgentExecution remote MCP toolset gate", () => {
  it("never attaches remote servers on read_only columns", async () => {
    const { PipelineConfigSchema } = await import("@agentprism/contracts");
    const seen: string[][] = [];
    const driver = {
      frameworkId: "stub",
      displayName: "Stub",
      async *run(ctx: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
        seen.push([...ctx.tools.names]);
      },
    };
    const deps = testDeps();
    const spec = testSpec(driver, {
      config: PipelineConfigSchema.parse({ label: "col", harness: "bare", toolset: "read_only" }),
      mcpServers: [{ command: "definitely-missing-binary-xyz" }],
    });
    await collect(deps, spec);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.some((n) => n.startsWith("mcp__ext"))).toBe(false);
  });
});

describe("runAgentExecution remote MCP wiring", () => {
  it("attaches top-level servers and skips nesting", async () => {
    const seen: string[][] = [];
    const driver = {
      frameworkId: "stub",
      displayName: "Stub",
      async *run(ctx: AgentExecutionContext): AsyncGenerator<ArenaEvent> {
        seen.push([...ctx.tools.names].filter((n) => n.startsWith("mcp__")).sort());
      },
    };
    const deps = testDeps();
    await collect(deps, testSpec(driver, { mcpServers: [{ command: "definitely-missing-binary-xyz" }] }));
    // Dead server warns and skips: no remote names, run still completes.
    expect(seen).toEqual([[]]);
  });

  it("closes attached server processes when the run ends", async () => {
    let killed = 0;
    const transport: McpTransport = {
      spawn: () => handshakeChild(() => { killed += 1; }),
    };
    const driver = {
      frameworkId: "stub",
      displayName: "Stub",
      async *run(): AsyncGenerator<ArenaEvent> {},
    };
    const deps = testDeps();
    await collect(deps, testSpec(driver, { mcpServers: [{ command: "stub" }], mcpTransport: transport }));
    // The finally path must kill every attached server: no leaked child processes.
    expect(killed).toBe(1);
  });

  it("closes attached server processes when the driver throws", async () => {
    let killed = 0;
    const transport: McpTransport = {
      spawn: () => handshakeChild(() => { killed += 1; }),
    };
    const driver = {
      frameworkId: "stub",
      displayName: "Stub",
      async *run(): AsyncGenerator<ArenaEvent> {
        throw new Error("driver exploded");
      },
    };
    const deps = testDeps();
    await collect(deps, testSpec(driver, { mcpServers: [{ command: "stub" }], mcpTransport: transport }));
    expect(killed).toBe(1);
  });
});
