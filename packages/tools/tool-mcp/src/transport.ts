/**
 * @file tool-mcp/transport
 * @description MCP stdio transport port plus the node child-process backend.
 *
 * Responsibilities:
 * - Define the duplex transport port (spawn, framed lines, kill)
 * - Ship the node:child_process backend with per-path serialization
 * - Spawn servers with a baseline env allowlist (never the full parent env)
 *
 * The port keeps protocol code (client) independent of process mechanics:
 * tests inject an in-memory duplex while production spawns real MCP servers.
 * Framing follows MCP stdio: `Content-Length` headers with JSON-RPC bodies.
 * Stderr inherits (server diagnostics stay visible); stdin/stdout are piped.
 */

import { spawn, type ChildProcess } from "node:child_process";

/** One spawned MCP server process (duplex byte streams as text lines). */
export interface McpChildProcess {
  /** Writes one framed message (adds headers + body). */
  write(message: string): void;
  /** Async stream of deframed message bodies (ends on process exit). */
  messages(): AsyncIterable<string>;
  /** Kills the process (idempotent). */
  kill(): void;
  /** Resolves when the process exits (code or signal). */
  exited(): Promise<{ code: number | null; signal: string | null }>;
}

/** Transport port: spawns MCP server commands. */
export interface McpTransport {
  spawn(command: string, args?: readonly string[], env?: Record<string, string>): McpChildProcess;
}

/** Parses `Content-Length` framed bodies out of a byte chunk buffer. */
export class FrameDecoder {
  private buffer = "";

  /** Pushes a text chunk, returning complete message bodies. */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const out: string[] = [];
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return out;
      const header = this.buffer.slice(0, headerEnd);
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
      if (lengthMatch?.[1] === undefined) {
        // Loud skip: a malformed header must not wedge the stream forever.
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number.parseInt(lengthMatch[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return out;
      out.push(this.buffer.slice(bodyStart, bodyStart + length));
      this.buffer = this.buffer.slice(bodyStart + length);
    }
  }
}

/** Frames one JSON-RPC body with headers. */
export function frameMessage(body: string): string {
  return `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n${body}`;
}

/**
 * Baseline environment handed to every spawned server: process mechanics only.
 * The full parent env (LLM keys, API tokens) is deliberately NOT inherited —
 * an operator-configured server process must not receive secrets it never
 * asked for. Windows shell/npm resolution needs the system and profile dirs;
 * anything else rides the per-server config env.
 */
const MCP_CHILD_ENV_BASELINE = [
  "PATH", "PATHEXT", "HOME", "USERPROFILE", "TEMP", "TMP",
  "SYSTEMROOT", "COMSPEC", "APPDATA", "LOCALAPPDATA",
] as const;

/** Builds the child env: baseline allowlist plus the server's configured env. */
export function buildMcpChildEnv(configured: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of MCP_CHILD_ENV_BASELINE) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...configured };
}

/** Node child-process MCP transport backend. */
export class NodeMcpTransport implements McpTransport {
  spawn(command: string, args: readonly string[] = [], env: Record<string, string> = {}): McpChildProcess {
    if (command.trim() === "") throw new Error("MCP server command must be non-empty");
    const child: ChildProcess = spawn(command, [...args], {
      env: buildMcpChildEnv(env),
      stdio: ["pipe", "pipe", "inherit"],
    });
    const decoder = new FrameDecoder();
    const queue: string[] = [];
    const waiters: Array<() => void> = [];
    let ended = false;
    // Wake on arrival AND on end: the consumer loop re-checks queue/ended
    // after every wake, so unconditional wakeups are safe (no lost wakeups).
    const wake = (): void => {
      while (waiters.length > 0) (waiters.shift() as () => void)();
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      for (const message of decoder.push(chunk.toString("utf-8"))) {
        queue.push(message);
        wake();
      }
    });
    const finish = (): void => {
      ended = true;
      wake();
    };
    child.on("exit", finish);
    child.on("error", finish);
    let exitResolve: (value: { code: number | null; signal: string | null }) => void = () => {};
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      exitResolve = resolve;
    });
    child.on("exit", (code, signal) => exitResolve({ code, signal }));
    child.on("error", () => exitResolve({ code: null, signal: null }));
    return {
      write(message: string): void {
        child.stdin?.write(frameMessage(message));
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
        try {
          child.kill();
        } catch {
          // Already exited: kill is idempotent by contract.
        }
      },
      exited: () => exited,
    };
  }
}
