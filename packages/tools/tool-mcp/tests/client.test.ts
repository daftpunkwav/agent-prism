/**
 * @file client test
 * @description Locks MCP handshake, listing, calls, timeouts, and server errors.
 */
import { describe, expect, it } from "vitest";
import { MapToolRegistry } from "@agentprism/tool-registry";
import { McpClient, McpError, mcpContentToText } from "../src/client.js";
import { registerRemoteMcpTools, remoteToolName } from "../src/remote-tools.js";
import { frameMessage, FrameDecoder } from "../src/transport.js";
import type { McpChildProcess, McpTransport } from "../src/transport.js";

/** In-memory duplex: scripted replies per method, observable writes. */
function fakeTransport(
  handlers: Record<string, (params: Record<string, unknown>) => unknown>,
  options: { malformed?: boolean; neverReply?: boolean; silentMethods?: readonly string[] } = {},
): McpTransport & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    spawn: (): McpChildProcess => {
      const pending: string[] = [];
      const waiters: Array<() => void> = [];
      let ended = false;
      const wake = (): void => {
        while (pending.length > 0 && waiters.length > 0) (waiters.shift() as () => void)();
      };
      return {
        write(message: string): void {
          writes.push(message);
          if (options.neverReply) return;
          const request = JSON.parse(message) as { id?: number; method?: string; params?: Record<string, unknown> };
          if (request.id === undefined || request.method === undefined) return;
          // Method-level silence: models a remote call that never answers while
          // the rest of the server keeps working (cancel-latency cases).
          if (options.silentMethods?.includes(request.method) === true) return;
          const respond = (payload: unknown): void => {
            const body = JSON.stringify({ jsonrpc: "2.0", id: request.id, ...(payload as Record<string, unknown>) });
            pending.push(options.malformed === true ? body.slice(0, 10) : body);
            wake();
          };
          const handler = handlers[request.method];
          if (handler === undefined) {
            respond({ error: { code: -32601, message: "Method not found" } });
            return;
          }
          try {
            respond({ result: handler(request.params ?? {}) });
          } catch (error) {
            respond({ error: { code: -32000, message: (error as Error).message } });
          }
        },
        async *messages(): AsyncGenerator<string> {
          for (;;) {
            const next = pending.shift();
            if (next !== undefined) {
              if (options.malformed === true) {
                // Malformed bodies are skipped by the client pump; end the stream.
                return;
              }
              yield next;
              continue;
            }
            if (ended) return;
            await new Promise<void>((resolve) => waiters.push(resolve));
          }
        },
        kill(): void {
          ended = true;
          while (waiters.length > 0) (waiters.shift() as () => void)();
        },
        exited: async () => ({ code: 0, signal: null }),
      };
    },
  };
}

const TOOLS = [
  { name: "read_file", description: "reads", inputSchema: { type: "object" } },
  { name: "boom", description: "fails", inputSchema: { type: "object" } },
];

function serverHandlers(): Record<string, (params: Record<string, unknown>) => unknown> {
  return {
    initialize: () => ({ protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fake", version: "0" } }),
    "tools/list": () => ({ tools: TOOLS }),
    "tools/call": (params) => {
      if ((params as { name?: string }).name === "boom") return { isError: true, content: [{ type: "text", text: "kaboom" }] };
      return { content: [{ type: "text", text: `contents of ${JSON.stringify((params as { arguments?: unknown }).arguments)}` }] };
    },
    "resources/list": () => ({
      resources: [
        { uri: "file:///workspace/notes.md", name: "notes", description: "run notes", mimeType: "text/markdown" },
        { uri: "file:///workspace/plan.md", name: "plan" },
      ],
    }),
    "resources/read": (params) => ({
      contents: [{ uri: (params as { uri?: string }).uri ?? "", mimeType: "text/markdown", text: "hello context" }],
    }),
  };
}

describe("McpClient", () => {
  it("handshakes, lists, and calls tools", async () => {
    const transport = fakeTransport(serverHandlers());
    const client = await McpClient.connect(transport, { command: "fake", timeoutMs: 1000 });
    try {
      expect(transport.writes.some((w) => w.includes("notifications/initialized"))).toBe(true);
      const tools = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(["read_file", "boom"]);
      expect(await client.callTool("read_file", { path: "a" })).toContain("a");
      await expect(client.callTool("boom", {})).rejects.toThrow(McpError);
    } finally {
      client.close();
    }
  });

  it("times out and surfaces unknown methods", async () => {
    const hanging = fakeTransport({}, { neverReply: true });
    await expect(McpClient.connect(hanging, { command: "fake", timeoutMs: 30 })).rejects.toThrow(/timed out|handshake/);
    const transport = fakeTransport({ initialize: () => ({}) });
    const client = await McpClient.connect(transport, { command: "fake", timeoutMs: 1000 });
    try {
      await expect(client.callTool("nope", {})).rejects.toThrow(McpError);
    } finally {
      client.close();
    }
  });

  /**
   * A server that died after the handshake must fail later requests fast with
   * "server stream ended" instead of burning the full per-request timeout on a
   * dead pipe. The pump resets when the stream ends so a later request re-pumps
   * and observes the ended transport immediately.
   */
  it("fails a post-mortem request fast instead of burning the timeout", async () => {
    let child: McpChildProcess | null = null;
    const queue: string[] = [];
    const waiters: Array<() => void> = [];
    let ended = false;
    const wake = (): void => {
      while (queue.length > 0 && waiters.length > 0) (waiters.shift() as () => void)();
    };
    const transport: McpTransport = {
      spawn: () => {
        child = {
          write(message: string): void {
            if (ended) return;
            const request = JSON.parse(message) as { id?: number };
            if (request.id === undefined) return;
            queue.push(
              JSON.stringify({
                jsonrpc: "2.0",
                id: request.id,
                result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fake", version: "0" } },
              }),
            );
            wake();
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
            while (waiters.length > 0) (waiters.shift() as () => void)();
          },
          exited: async () => ({ code: 0, signal: null }),
        };
        return child;
      },
    };
    const client = await McpClient.connect(transport, { command: "fake", timeoutMs: 1500 });
    // The server dies right after the handshake; let the pump observe the ended
    // stream and settle before the next request (the regression case).
    (child as unknown as McpChildProcess).kill();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await expect(client.listTools()).rejects.toThrow(/server stream ended/);
  });

  /**
   * A server-initiated request answered while the child's pipe is already broken
   * makes the pump's own write throw. The pump promise is never awaited, so that
   * exception must be caught (and logged) instead of escaping as an unhandled
   * rejection that crashes the host.
   */
  it("catches a pump-side write failure instead of leaking an unhandled rejection", async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", onRejection);
    let writes = 0;
    const queue: string[] = [];
    const waiters: Array<() => void> = [];
    const wake = (): void => {
      while (queue.length > 0 && waiters.length > 0) (waiters.shift() as () => void)();
    };
    const transport: McpTransport = {
      spawn: () => ({
        write(message: string): void {
          writes += 1;
          const request = JSON.parse(message) as { id?: number };
          if (writes === 1) {
            // Handshake reply.
            queue.unshift(
              JSON.stringify({
                jsonrpc: "2.0",
                id: request.id,
                result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fake", version: "0" } },
              }),
            );
            wake();
            return;
          }
          if (writes === 2) {
            // With the handshake notification the server sends a request of its
            // own; the client answers through a pipe that is already broken.
            queue.push(JSON.stringify({ jsonrpc: "2.0", id: 77, method: "roots/list", params: {} }));
            wake();
            return;
          }
          throw new Error("EPIPE: pipe broken");
        },
        async *messages(): AsyncGenerator<string> {
          for (;;) {
            const next = queue.shift();
            if (next !== undefined) {
              yield next;
              continue;
            }
            await new Promise<void>((resolve) => waiters.push(resolve));
          }
        },
        kill(): void {},
        exited: async () => ({ code: 0, signal: null }),
      }),
    };
    const client = await McpClient.connect(transport, { command: "fake", timeoutMs: 1000 });
    try {
      // Let the pump reach the server-initiated request and hit the throwing write.
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
      client.close();
    }
  });
});

describe("mcpContentToText", () => {
  it("joins text blocks and notes others", () => {
    expect(mcpContentToText([{ type: "text", text: "hi" }])).toBe("hi");
    expect(mcpContentToText([{ type: "image" }])).toContain("omitted");
    expect(mcpContentToText("nope")).toContain("no content");
  });
});

describe("McpClient resources", () => {
  it("lists resources and reads text content", async () => {
    const transport = fakeTransport(serverHandlers());
    const client = await McpClient.connect(transport, { command: "fake", timeoutMs: 1000 });
    try {
      const resources = await client.listResources();
      expect(resources).toHaveLength(2);
      expect(resources[0]).toMatchObject({ uri: "file:///workspace/notes.md", name: "notes" });
      expect(await client.readResource("file:///workspace/notes.md")).toContain("hello context");
    } finally {
      client.close();
    }
  });

  it("returns a sentinel for empty resource content", async () => {
    const handlers = serverHandlers();
    handlers["resources/read"] = () => ({ contents: [] });
    const transport = fakeTransport(handlers);
    const client = await McpClient.connect(transport, { command: "fake", timeoutMs: 1000 });
    try {
      expect(await client.readResource("file:///empty.md")).toContain("empty");
    } finally {
      client.close();
    }
  });
});

describe("registerRemoteMcpTools", () => {  it("bridges remote tools with namespaced names and allowlists", async () => {
    const transport = fakeTransport(serverHandlers());
    const client = await McpClient.connect(transport, { command: "fake", timeoutMs: 1000 });
    try {
      const registry = new MapToolRegistry();
      const names = await registerRemoteMcpTools(registry, client, "fs!", ["read_file"]);
      expect(names).toEqual([remoteToolName("fs!", "read_file")]);
      expect(names[0]).toBe("mcp__fs__read_file");
      const ws = { name: "ws", root: "", cwd: () => "", fs: null };
      const out = await registry.execute(ws, names[0] as string, { path: "a" }, {});
      expect(out.ok).toBe(true);
      expect(out.result).toContain("a");
    } finally {
      client.close();
    }
  });

  it("stops waiting on a remote call when the caller aborts", async () => {
    // The call itself never answers: without the abort race the bridged tool
    // would sit on the per-request timeout (30s by default) before the cancelled
    // column could tear down, and would report a timeout instead of a cancel.
    const transport = fakeTransport(serverHandlers(), { silentMethods: ["tools/call"] });
    const client = await McpClient.connect(transport, { command: "fake", timeoutMs: 1500 });
    try {
      const registry = new MapToolRegistry();
      const names = await registerRemoteMcpTools(registry, client, "ext1", ["read_file"]);
      const ws = { name: "ws", root: "", cwd: () => "", fs: null };
      const controller = new AbortController();
      const started = Date.now();
      const call = registry.execute(ws, names[0] as string, { path: "a" }, { signal: controller.signal });
      setTimeout(() => controller.abort(), 10);
      await expect(call).rejects.toMatchObject({ name: "AbortError" });
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      client.close();
    }
  });

  it("sanitizes provider-invalid remote names and skips unresolvable conflicts", async () => {
    const tools = [
      { name: "issues.create", description: "dotted", inputSchema: { type: "object" } },
      { name: "issues/create", description: "slashed", inputSchema: { type: "object" } },
      { name: "x".repeat(80), description: "too long", inputSchema: { type: "object" } },
    ];
    const transport = fakeTransport({ ...serverHandlers(), "tools/list": () => ({ tools }) });
    const client = await McpClient.connect(transport, { command: "fake", timeoutMs: 1000 });
    try {
      const registry = new MapToolRegistry();
      const names = await registerRemoteMcpTools(registry, client, "ext1");
      // Both dotted and slashed names sanitize to one bridged name: the first wins
      // (registering the second would point the name at the wrong tool), and the
      // 80-char name is skipped because providers reject names over 64 chars.
      expect(names).toEqual(["mcp__ext1__issues_create"]);
      expect(names[0]?.length).toBeLessThanOrEqual(64);
    } finally {
      client.close();
    }
  });
});

describe("FrameDecoder", () => {
  it("deframes split chunks, tolerates CRLF, and skips blank lines", () => {
    const decoder = new FrameDecoder();
    const framed = frameMessage('{"a":1}');
    const half = Math.floor(framed.length / 2);
    expect(decoder.push(framed.slice(0, half))).toEqual([]);
    expect(decoder.push(framed.slice(half))).toEqual(['{"a":1}']);
    // A CRLF writer and stray keep-alive newlines must not produce phantom bodies.
    expect(decoder.push('{"b":2}\r\n\n{"c":3}\n')).toEqual(['{"b":2}', '{"c":3}']);
  });
});
