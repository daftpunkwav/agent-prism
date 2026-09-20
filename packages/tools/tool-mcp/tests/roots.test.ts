/**
 * @file roots test
 * @description Locks roots advertisement and server-initiated request handling.
 */
import { describe, expect, it } from "vitest";
import { McpClient, toFileUri } from "../src/client.js";
import type { McpChildProcess, McpTransport } from "../src/transport.js";

describe("toFileUri", () => {
  it("builds encoded file URIs", () => {
    expect(toFileUri("/tmp/ws")).toBe("file:///tmp/ws");
    expect(toFileUri("my docs")).toBe("file:///my%20docs");
  });
});

describe("roots/list serving", () => {
  it("answers roots/list with advertised roots and rejects unknown methods", async () => {
    const writes: string[] = [];
    const queue: string[] = [];
    const waiters: Array<() => void> = [];
    let ended = false;
    const transport: McpTransport = {
      spawn: (): McpChildProcess => ({
        write(message: string): void {
          writes.push(message);
          const request = JSON.parse(message) as { id?: number; method?: string };
          if (request.method === "initialize" && request.id !== undefined) {
            queue.push(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} }));
          } else if (request.method === "tools/list" && request.id !== undefined) {
            queue.push(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [] } }));
          }
          while (waiters.length > 0) (waiters.shift() as () => void)();
        },
        async *messages(): AsyncGenerator<string> {
          // Server-initiated roots/list arrives right after the handshake.
          queue.push(JSON.stringify({ jsonrpc: "2.0", id: 99, method: "roots/list", params: {} }));
          queue.push(JSON.stringify({ jsonrpc: "2.0", id: 100, method: "nope/method", params: {} }));
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
      }),
    };
    const client = await McpClient.connect(transport, { command: "fake", timeoutMs: 1000 }, { roots: ["/tmp/ws"] });
    try {
      // Let the pump answer both server-initiated requests.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const rootsReply = writes.map((w) => { try { return JSON.parse(w); } catch { return null; } }).find((m) => m?.id === 99);
      expect(rootsReply?.result).toEqual({ roots: [{ uri: "file:///tmp/ws", name: "/tmp/ws" }] });
      const rejectReply = writes.map((w) => { try { return JSON.parse(w); } catch { return null; } }).find((m) => m?.id === 100);
      expect(rejectReply?.error?.code).toBe(-32601);
      // Handshake advertised roots capability.
      const init = writes.map((w) => { try { return JSON.parse(w); } catch { return null; } }).find((m) => m?.method === "initialize");
      expect(init?.params?.capabilities).toMatchObject({ roots: { listChanged: false } });
    } finally {
      client.close();
    }
  });

  it("omits roots capability without roots", async () => {
    const writes: string[] = [];
    const transport: McpTransport = {
      spawn: (): McpChildProcess => ({
        write(message: string): void {
          writes.push(message);
          const request = JSON.parse(message) as { id?: number; method?: string };
          if (request.id !== undefined) {
            setTimeout(() => {}, 0);
          }
          void request;
        },
        async *messages(): AsyncGenerator<string> {
          return;
        },
        kill(): void {},
        exited: async () => ({ code: 0, signal: null }),
      }),
    };
    // Stream ends immediately: handshake fails fast, no hang.
    await expect(McpClient.connect(transport, { command: "fake", timeoutMs: 500 })).rejects.toThrow();
    const init = writes.map((w) => { try { return JSON.parse(w); } catch { return null; } }).find((m) => m?.method === "initialize");
    expect(init?.params?.capabilities).toEqual({ tools: {} });
  });
});
