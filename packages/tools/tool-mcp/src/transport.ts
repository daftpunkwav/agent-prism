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
 * Framing follows MCP stdio: one JSON-RPC message per line (newline-delimited,
 * `JSON.stringify` never emits a raw newline inside a body).
 * Stderr inherits (server diagnostics stay visible); stdin/stdout are piped.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

/** One spawned MCP server process (duplex byte streams as text lines). */
export interface McpChildProcess {
  /** Writes one message, framed as a single newline-delimited line. */
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

/** Parses newline-delimited JSON-RPC bodies out of a text chunk buffer. */
export class FrameDecoder {
  private buffer = "";

  /** Pushes a text chunk, returning complete message bodies. */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const out: string[] = [];
    for (;;) {
      const lineEnd = this.buffer.indexOf("\n");
      if (lineEnd === -1) return out;
      // Tolerate CRLF writers and blank keep-alive lines: neither is a message.
      const line = this.buffer.slice(0, lineEnd).replace(/\r$/, "");
      this.buffer = this.buffer.slice(lineEnd + 1);
      if (line.trim() === "") continue;
      out.push(line);
    }
  }
}

/** Frames one JSON-RPC body as a newline-delimited line. */
export function frameMessage(body: string): string {
  return `${body}\n`;
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
    // Incremental UTF-8 decoding: a multi-byte character split across two chunks
    // must survive, so decode through StringDecoder instead of per-chunk toString.
    const textDecoder = new StringDecoder("utf-8");
    const queue: string[] = [];
    const waiters: Array<() => void> = [];
    let ended = false;
    // Wake on arrival AND on end: the consumer loop re-checks queue/ended
    // after every wake, so unconditional wakeups are safe (no lost wakeups).
    const wake = (): void => {
      while (waiters.length > 0) (waiters.shift() as () => void)();
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      for (const message of decoder.push(textDecoder.write(chunk))) {
        queue.push(message);
        wake();
      }
    });
    const finish = (): void => {
      // Flush the incremental decoder: it can only hold an incomplete multi-byte
      // sequence, never a whole message (a body is only emitted on its newline), so a
      // server that dies without a trailing newline loses that last message — the
      // protocol requires the newline.
      for (const message of decoder.push(textDecoder.end())) {
        queue.push(message);
      }
      ended = true;
      wake();
    };
    // 'close' (not just 'exit') is what guarantees stdio is drained, so the tail of the
    // stream still reaches the consumer; both paths are idempotent via `ended`.
    child.on("exit", finish);
    child.on("close", finish);
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
