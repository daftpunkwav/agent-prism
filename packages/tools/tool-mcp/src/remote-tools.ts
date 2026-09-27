/**
 * @file tool-mcp/remote-tools
 * @description Bridges stdio MCP server tools into a ToolRegistry.
 *
 * Responsibilities:
 * - List remote tools through an McpClient and register delegating definitions
 * - Enforce server allowlists and name namespacing (`mcp__<server>__<tool>`)
 *
 * Remote names carry the server tag so traces show exactly which process
 * served each call. Registration is explicit per server (no ambient
 * discovery): the host owns server lifecycles and calls this per client.
 */

import type { ToolDefinition, ToolRegistry } from "@agentprism/contracts";
import { McpClient, McpError } from "./client.js";

/**
 * Max remote tool name length accepted (over-long names fail registration).
 * Every model provider constrains tool names to `^[a-zA-Z0-9_-]{1,64}$`; a longer
 * bridged name is rejected upstream and fails the whole request, not just the tool.
 */
export const REMOTE_TOOL_NAME_LIMIT = 64;

/** Bridged descriptions are third-party model-facing text: bound the blurb. */
const REMOTE_TOOL_DESCRIPTION_LIMIT = 500;

/**
 * Namespaces a remote tool under its server (`mcp__<server>__<tool>`).
 * The tool segment is sanitized to the same provider grammar as the tag: names
 * carrying dots, spaces, or non-ASCII (legal for MCP servers) would otherwise
 * ride into the provider payload verbatim and invalidate the request.
 */
export function remoteToolName(serverTag: string, toolName: string): string {
  const tag = serverTag.trim().replace(/[^a-z0-9_-]/gi, "").slice(0, 32) || "server";
  const tool = toolName.trim().replace(/[^a-z0-9_-]/gi, "_") || "tool";
  return `mcp__${tag}__${tool}`;
}

/**
 * Awaits one remote call while honoring the caller's cancellation.
 *
 * The MCP subset has no cancel notification, so a cancelled run can only stop
 * *waiting*: the server-side call keeps running and its late reply is discarded
 * by the client (close() rejects it). Without this race a stopped column would
 * sit on the remote call until its per-request timeout (30s default) before any
 * teardown — cancellation must not be bounded by a remote budget. AbortError is
 * thrown exactly like a cancelled builtin (bash/registry contract), so drivers
 * converge the run instead of feeding "aborted" text back to the model.
 */
function callWithAbort<T>(call: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return call;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      const aborted = new Error("Aborted");
      aborted.name = "AbortError";
      reject(aborted);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    call.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Registers a connected server's tools into the registry.
 * @returns Sorted registered names. Throws McpError when listing fails.
 */
export async function registerRemoteMcpTools(
  registry: ToolRegistry,
  client: McpClient,
  serverTag: string,
  allowlist?: readonly string[],
): Promise<string[]> {
  const allowed = allowlist === undefined ? null : new Set(allowlist);
  const registered: string[] = [];
  const seen = new Set<string>();
  for (const remote of await client.listTools()) {
    if (allowed !== null && !allowed.has(remote.name)) continue;
    const name = remoteToolName(serverTag, remote.name);
    // Sanitizing maps distinct remote names onto one bridged name ("a.b" and "a/b"
    // both become "a_b"): registering the second would silently shadow the first,
    // so the model would call one tool and reach the other.
    if (name.length > REMOTE_TOOL_NAME_LIMIT || seen.has(name)) continue;
    seen.add(name);
    const definition: ToolDefinition = {
      name,
      description: `MCP server ${serverTag}: ${(remote.description || remote.name).slice(0, REMOTE_TOOL_DESCRIPTION_LIMIT)}`,
      jsonSchema: remote.inputSchema,
      mutatesWorkspace: false,
      execute: async (_workspace, args, signal) => {
        if (signal?.aborted) {
          return { result: "Error: aborted", fileDiff: null, ok: false, code: "aborted" };
        }
        try {
          const result = await callWithAbort(client.callTool(remote.name, args), signal);
          return { result, fileDiff: null, ok: true };
        } catch (error) {
          if (error instanceof McpError) {
            return { result: `Error: ${error.message}`, fileDiff: null, ok: false, code: "workspace_error" };
          }
          throw error;
        }
      },
    };
    registry.register(definition);
    registered.push(name);
  }
  return registered.sort();
}
