/**
 * @file tool-mcp/client
 * @description Minimal MCP JSON-RPC 2.0 client over the stdio transport.
 *
 * Responsibilities:
 * - Handshake (initialize + notifications/initialized)
 * - tools/list and tools/call with request ids, timeouts, and fail-closed errors
 * - Serialize concurrent calls over one duplex process
 *
 * Protocol subset, honestly bounded: stdio framing, initialize, tools/list,
 * tools/call, resources/list, resources/read, roots serving, and error
 * surfacing. Sampling and prompts are out of scope (the agent loop only needs
 * tools plus read-only resource context). Every remote failure becomes a loud
 * tool result or a thrown McpError — never silent.
 */

import type { McpResource } from "@agentprism/contracts";
import type { McpChildProcess, McpTransport } from "./transport.js";

/** MCP-side failure (protocol, timeout, or server-reported error). */
export class McpError extends Error {
  constructor(message: string) {
    super(`MCP: ${message}`);
    this.name = "McpError";
  }
}

/** Remote tool description from tools/list. */
export interface McpRemoteTool {
  name: string;
  description: string;
  /** JSON Schema for arguments (opaque to the client, bridged to the model). */
  inputSchema: Record<string, unknown>;
}

/** Converts a workspace path into a file:// URI for roots advertisement. */
export function toFileUri(path: string): string {
  const absolute = path.startsWith("/") ? path : `/${path}`;
  return `file://${absolute.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`;
}

/** Client options: workspace roots advertised to servers requesting roots/list. */
export interface McpClientOptions {
  roots?: readonly string[];
}

/** Server process configuration. */
export interface McpServerConfig {
  command: string;
  args?: readonly string[];
  env?: Record<string, string>;
  /** Per-request timeout in ms (default 30s). */
  timeoutMs?: number;
  /** Allowlisted remote tool names (default: all). */
  tools?: readonly string[];
  /** Settings-view display name (defaults to the command basename). */
  name?: string;
  /** Disabled servers persist but never attach to runs (default true). */
  enabled?: boolean;
}

/** Default per-request timeout in ms. */
export const MCP_DEFAULT_TIMEOUT_MS = 30_000;

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Extracts text from an MCP content array (text blocks joined, others noted). */
export function mcpContentToText(content: unknown): string {
  if (!Array.isArray(content)) return "(MCP returned no content)";
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
    else if (typeof block.type === "string") parts.push(`[${String(block.type)} content omitted]`);
  }
  return parts.length === 0 ? "(MCP returned no text content)" : parts.join("\n");
}

/** JSON-RPC client bound to one spawned MCP server process. */
export class McpClient {
  private readonly process: McpChildProcess;
  private readonly timeoutMs: number;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private pump: Promise<void> | null = null;
  private closed = false;

  private readonly roots: string[];

  private constructor(child: McpChildProcess, timeoutMs: number, roots: readonly string[] = []) {
    this.process = child;
    this.timeoutMs = timeoutMs;
    this.roots = [...roots];
  }

  /**
   * Spawns the server and completes the initialize handshake.
   * Throws McpError when the server never answers (fail-closed, kills child).
   */
  static async connect(transport: McpTransport, config: McpServerConfig, options: McpClientOptions = {}): Promise<McpClient> {
    const timeoutMs = config.timeoutMs ?? MCP_DEFAULT_TIMEOUT_MS;
    let child: McpChildProcess;
    try {
      child = transport.spawn(config.command, config.args ?? [], config.env ?? {});
    } catch (error) {
      throw new McpError(`spawn failed: ${(error as Error)?.message ?? String(error)}`);
    }
    const client = new McpClient(child, timeoutMs, options.roots ?? []);
    try {
      await client.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {}, ...(client.roots.length > 0 ? { roots: { listChanged: false } } : {}) },
        clientInfo: { name: "agent-prism", version: "0.1.0" },
      });
      client.notify("notifications/initialized", {});
      return client;
    } catch (error) {
      client.close();
      throw error instanceof McpError ? error : new McpError(`handshake failed: ${(error as Error)?.message ?? String(error)}`);
    }
  }

  /** Lists remote tools (allowlist applied by the caller, not here). */
  async listTools(): Promise<McpRemoteTool[]> {
    const result = await this.request<Record<string, unknown>>("tools/list", {});
    const tools = result.tools;
    if (!Array.isArray(tools)) throw new McpError("tools/list returned no tools array");
    const out: McpRemoteTool[] = [];
    for (const tool of tools) {
      if (!isRecord(tool) || typeof tool.name !== "string") continue;
      out.push({
        name: tool.name,
        description: typeof tool.description === "string" ? tool.description : "",
        inputSchema: isRecord(tool.inputSchema) ? tool.inputSchema : { type: "object" },
      });
    }
    return out;
  }

  /** Calls a remote tool and returns flattened text (server errors throw). */
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.request<Record<string, unknown>>("tools/call", { name, arguments: args });
    if (result.isError === true) {
      throw new McpError(`tool ${name} reported error: ${mcpContentToText(result.content).slice(0, 500)}`);
    }
    return mcpContentToText(result.content);
  }

  /** Lists remote MCP resources advertised by the server. */
  async listResources(): Promise<McpResource[]> {
    const response = await this.request<{ resources?: unknown[] }>("resources/list", {});
    const resources = Array.isArray(response.resources) ? response.resources : [];
    const out: McpResource[] = [];
    for (const r of resources) {
      if (!isRecord(r) || typeof r.uri !== "string" || typeof r.name !== "string") continue;
      out.push({
        uri: r.uri,
        name: r.name,
        description: typeof r.description === "string" ? r.description : undefined,
        mimeType: typeof r.mimeType === "string" ? r.mimeType : undefined,
      });
    }
    return out;
  }

  /** Reads a remote MCP resource by URI and returns text content. */
  async readResource(uri: string): Promise<string> {
    const result = await this.request<{ contents?: unknown[] }>("resources/read", { uri });
    const contents = Array.isArray(result.contents) ? result.contents : [];
    const texts: string[] = [];
    for (const item of contents) {
      if (isRecord(item) && typeof item.text === "string") {
        texts.push(item.text);
      }
    }
    return texts.length > 0 ? texts.join("\n") : "(empty resource content)";
  }


  /** Kills the child and rejects pending calls (idempotent). */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new McpError("client closed"));
    }
    this.pending.clear();
    this.process.kill();
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.pumpMessages();
    this.process.write(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  private request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    this.pumpMessages();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpError(`request ${method} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        timer,
      });
      this.process.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  /** Answers one server-initiated request (roots served, rest rejected). */
  private answerServerRequest(message: Record<string, unknown>): void {
    const id = message.id as number;
    const method = message.method as string;
    if (method === "roots/list") {
      this.process.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: { roots: this.roots.map((root) => ({ uri: toFileUri(root), name: root })) },
        }),
      );
      return;
    }
    this.process.write(
      JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } }),
    );
  }

  private pumpMessages(): void {
    if (this.pump !== null) return;
    this.pump = (async () => {
      for await (const body of this.process.messages()) {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(body) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (typeof message.id !== "number") continue;
        const pending = this.pending.get(message.id);
        if (pending === undefined) {
          // Server-initiated request (no matching client call): serve
          // roots/list from the advertised roots, reject the rest loudly.
          if (typeof message.method === "string") this.answerServerRequest(message);
          continue;
        }
        this.pending.delete(message.id);
        if ("error" in message && isRecord(message.error)) {
          const code = (message.error as Record<string, unknown>).code;
          const text = (message.error as Record<string, unknown>).message;
          pending.reject(new McpError(`server error ${String(code)}: ${String(text).slice(0, 300)}`));
        } else if ("result" in message) {
          pending.resolve(message.result ?? {});
        } else {
          pending.reject(new McpError("server replied without result or error"));
        }
      }
      for (const [, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new McpError("server stream ended"));
      }
      this.pending.clear();
    })();
  }
}
