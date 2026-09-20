/**
 * @file tool-mcp/servers
 * @description In-process MCP capability servers (filesystem + fetch).
 *
 * Responsibilities:
 * - Define filesystem and fetch server tool definitions over ToolWorkspace
 * - Keep handlers dependency-free (structural fs, injected fetch capability, deterministic truncation)
 *
 * Servers run in-process against the column workspace: no sockets, no child
 * processes, no external MCP transport. Names use the `mcp__` prefix so model
 * transcripts show exactly when an MCP bridge (rather than a builtin) served a call.
 */

import { UrlValidationError } from "@agentprism/contracts";
import type { ToolArgs, ToolDefinition, ToolExecutionResult, ToolWorkspace } from "@agentprism/contracts";

/** Minimal structural filesystem surface used by the fs server (satisfied by the runtime Workspace fs). */
interface StructuralFs {
  readFile(path: string): string;
  listFiles(dir: string, options?: { recursive?: boolean }): string[];
}

function asFs(workspace: ToolWorkspace): StructuralFs | null {
  const fs = workspace.fs as Partial<StructuralFs> | null | undefined;
  if (fs === undefined || fs === null) return null;
  if (typeof fs.readFile !== "function" || typeof fs.listFiles !== "function") return null;
  return fs as StructuralFs;
}

const MAX_MCP_READ = 16 * 1024;

function cap(text: string, max = MAX_MCP_READ): string {
  if (text.length <= max) return text;
  const tail = Math.min(2048, Math.floor(max / 5));
  const marker = `\n…[mcp middle pruned: ${text.length} chars]…\n`;
  const head = max - tail - marker.length;
  if (head <= 0) return `${text.slice(0, max)}\n…(truncated)`;
  return `${text.slice(0, head)}${marker}${text.slice(text.length - tail)}`;
}

/** MCP filesystem read: scoped read through the column workspace. */
export const mcpFsReadTool: ToolDefinition = {
  name: "mcp__fs_read",
  description: "MCP filesystem server: read a workspace-relative file (scoped to the column workspace).",
  jsonSchema: {
    type: "object",
    properties: { path: { type: "string", description: "Workspace-relative file path" } },
    required: ["path"],
    additionalProperties: false,
  },
  mutatesWorkspace: false,
  execute: async (workspace, args) => {
    const path = String((args as ToolArgs).path ?? "").trim();
    if (path === "" || path.startsWith("/") || path.includes("..")) {
      return { result: "Error: path must be a workspace-relative file without traversal", fileDiff: null, ok: false, code: "workspace_error" };
    }
    const fs = asFs(workspace);
    if (fs === null) return { result: "Error: workspace filesystem unavailable", fileDiff: null, ok: false, code: "workspace_error" };
    try {
      return { result: cap(fs.readFile(path)), fileDiff: null, ok: true };
    } catch {
      return { result: `Error: cannot read ${JSON.stringify(path)}`, fileDiff: null, ok: false, code: "workspace_error" };
    }
  },
};

/** MCP filesystem list: scoped directory listing through the column workspace. */
export const mcpFsListTool: ToolDefinition = {
  name: "mcp__fs_list",
  description: "MCP filesystem server: list files under a workspace-relative directory.",
  jsonSchema: {
    type: "object",
    properties: { dir: { type: "string", description: "Workspace-relative directory ('.' for root)" } },
    required: [],
    additionalProperties: false,
  },
  mutatesWorkspace: false,
  execute: async (workspace, args) => {
    const raw = String((args as ToolArgs).dir ?? ".").trim() || ".";
    if (raw.startsWith("/") || raw.includes("..")) {
      return { result: "Error: dir must be a workspace-relative directory without traversal", fileDiff: null, ok: false, code: "workspace_error" };
    }
    const fs = asFs(workspace);
    if (fs === null) return { result: "Error: workspace filesystem unavailable", fileDiff: null, ok: false, code: "workspace_error" };
    try {
      const entries = fs.listFiles(raw === "." ? "." : raw, { recursive: false });
      const lines = [...entries].sort().slice(0, 200);
      return { result: lines.length > 0 ? cap(lines.join("\n"), 8000) : "(empty directory)", fileDiff: null, ok: true };
    } catch {
      return { result: `Error: cannot list ${JSON.stringify(raw)}`, fileDiff: null, ok: false, code: "workspace_error" };
    }
  },
};

/** Per-request timeout for the MCP fetch server (registry arms the derived signal). */
export const MCP_FETCH_TIMEOUT_MS = 15_000;

/**
 * Host-provided fetch capability: the in-process fetch server owns the tool
 * surface (schema, budget, truncation), while the host owns network policy.
 * Production injects the SSRF-guarded safe-fetch from tool-builtins; tests
 * inject stubs. Absent capability fails closed with a loud refusal.
 */
export interface McpFetchDeps {
  /**
   * Fetches one URL and returns bounded body text.
   * Throws UrlValidationError for policy rejections, AbortError for cancels,
   * and Error (message surfaces to the model) for HTTP/network failures.
   */
  fetchUrl: (url: string, signal: AbortSignal | undefined) => Promise<string>;
  /** Per-fetch timeout in ms (default MCP_FETCH_TIMEOUT_MS); settings-tunable. */
  timeoutMs?: number;
}

function failClosedFetch(): Promise<string> {
  return Promise.reject(new Error("MCP fetch server has no host fetch capability (fail-closed)"));
}

/** MCP fetch server: URL fetch through the host-provided fetch capability. */
export function createMcpFetchTool(deps: McpFetchDeps): ToolDefinition {
  const timeoutMs = deps.timeoutMs ?? MCP_FETCH_TIMEOUT_MS;
  return {
    name: "mcp__fetch_url",
    description: "MCP fetch server: fetch an http(s) URL and return text (truncated). Non-http URLs are rejected.",
    jsonSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute http(s) URL to fetch" },
        max_chars: { type: "number", description: "Max characters to return (default 8000, cap 16000)" },
      },
      required: ["url"],
      additionalProperties: false,
    },
    mutatesWorkspace: false,
    timeoutMs,
    execute: async (_workspace, args, signal) => {
      const url = String((args as ToolArgs).url ?? "").trim();
      if (!/^https?:\/\//i.test(url)) {
        return { result: "Error: url must be an absolute http(s) URL", fileDiff: null, ok: false, code: "workspace_error" };
      }
      const rawMax = (args as ToolArgs).max_chars;
      const maxChars = rawMax === undefined || rawMax === null || rawMax === "" ? 8000 : Math.trunc(Number(rawMax));
      const budget = Number.isFinite(maxChars) ? Math.min(16000, Math.max(256, maxChars)) : 8000;
      try {
        const text = await deps.fetchUrl(url, signal ?? AbortSignal.timeout(timeoutMs));
        const out: ToolExecutionResult = { result: cap(text, budget), fileDiff: null, ok: true };
        return out;
      } catch (error) {
        if (error instanceof UrlValidationError) {
          return { result: `Error: url not allowed: ${error.message}`, fileDiff: null, ok: false, code: "workspace_error" };
        }
        if (error instanceof Error && error.name === "AbortError") {
          return { result: "Error: fetch aborted", fileDiff: null, ok: false, code: "aborted" };
        }
        return { result: `Error: fetch failed: ${error instanceof Error ? error.message.slice(0, 160) : "unknown"}`, fileDiff: null, ok: false, code: "workspace_error" };
      }
    },
  };
}

/** Fail-closed default: loud refusal when no host capability was injected. */
export const mcpFetchTool: ToolDefinition = createMcpFetchTool({ fetchUrl: failClosedFetch });

/** All MCP server tool definitions by server. */
export function mcpServerTools(deps?: Partial<McpFetchDeps>): Record<"fs" | "fetch", readonly ToolDefinition[]> {
  return {
    fs: [mcpFsListTool, mcpFsReadTool],
    fetch: [createMcpFetchTool({ fetchUrl: deps?.fetchUrl ?? failClosedFetch })],
  };
}

/** Default server tool set (fail-closed fetch until a host injects capability). */
export const MCP_SERVER_TOOLS: Record<"fs" | "fetch", readonly ToolDefinition[]> = mcpServerTools();
