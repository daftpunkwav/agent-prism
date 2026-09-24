/**
 * @file tools/webfetch
 * @description Builtin webfetch tool: fetch a URL and return readable text.
 *
 * Responsibilities:
 * - Declare the tool's JSON schema
 * - Fetch http(s) pages through the SSRF-guarded safe-fetch seam (timeout, size caps)
 * - Strip HTML to plain text and bound oversized results via spill
 */

import type { ToolArgs, ToolDefinition, ToolExecutionResult, ToolWorkspace } from "@agentprism/contracts";
import { UrlValidationError } from "@agentprism/contracts";
import { WorkspaceError } from "@agentprism/environment";
import { MAX_OUTPUT, readInt } from "./caps.js";
import { toolTuningValue } from "../tuning.js";
import { safeFetchText } from "./safe-fetch.js";
import { boundText } from "./spill.js";
import { asWorkspaceView } from "./workspace-view.js";

export const WEBFETCH_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    url: { type: "string", description: "Absolute http(s) URL to fetch" },
    max_length: { type: "integer", description: "Optional character cap for the returned text" },
  },
  required: ["url"],
  additionalProperties: false,
};

const FETCH_TIMEOUT_MS = 15_000;

/**
 * Converts HTML to readable text: scripts/styles/noscript removed, block tags
 * become line breaks, remaining tags stripped, entities and whitespace normalized.
 * Deliberately simple — the model reads a text projection, not a browser rendering.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|article|header|footer|li|tr|h[1-6]|blockquote|pre)>/gi, "\n")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

async function executeWebfetch(
  workspace: ToolWorkspace,
  args: ToolArgs,
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  const url = String(args.url ?? "").trim();
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { result: "Error: url must be an absolute URL", fileDiff: null, ok: false, code: "workspace_error" };
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return {
      result: `Error: unsupported protocol ${target.protocol} (use http/https)`,
      fileDiff: null,
      ok: false,
      code: "workspace_error",
    };
  }

  const timeoutMs = toolTuningValue("webFetchTimeoutMs", FETCH_TIMEOUT_MS);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const linked = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  try {
    // Guarded fetch: SSRF validation, DNS-resolution re-validation, manual
    // redirects with per-hop re-validation, and a bounded streaming read.
    const { response, text: raw } = await safeFetchText(url, {
      signal: linked,
      headers: {
        "User-Agent": "AgentPrism-WebFetch/0.1",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
      },
    });
    if (!response.ok) {
      return {
        result: `Error: HTTP ${response.status} ${response.statusText}`,
        fileDiff: null,
        ok: false,
        code: "workspace_error",
      };
    }
    const contentType = response.headers.get("content-type") ?? "";
    const text = contentType.includes("html") ? htmlToText(raw) : raw.trim();
    const maxLength = readInt(args, "max_length", toolTuningValue("maxOutputChars", MAX_OUTPUT));
    return { result: boundText(workspace, "webfetch", text, maxLength), fileDiff: null, ok: true };
  } catch (error) {
    if (error instanceof UrlValidationError) {
      return {
        result: `Error: url not allowed: ${error.message}`,
        fileDiff: null,
        ok: false,
        code: "workspace_error",
      };
    }
    if ((error as Error)?.name === "AbortError") {
      const aborted = signal?.aborted === true;
      return {
        result: aborted ? "Error: aborted" : `Error: fetch timed out (${timeoutMs}ms)`,
        fileDiff: null,
        ok: false,
        code: aborted ? "aborted" : "workspace_error",
      };
    }
    return {
      result: `Error: fetch failed: ${(error as Error)?.message?.slice(0, 120) ?? "unknown"}`,
      fileDiff: null,
      ok: false,
      code: "workspace_error",
    };
  }
}

/** Builtin webfetch tool definition. */
export const webfetchTool: ToolDefinition = {
  name: "webfetch",
  description: "Fetch an http(s) URL and return its readable text content.",
  jsonSchema: WEBFETCH_JSON_SCHEMA,
  mutatesWorkspace: false,
  get timeoutMs(): number {
    return toolTuningValue("webFetchTimeoutMs", FETCH_TIMEOUT_MS);
  },
  execute: executeWebfetch,
};
