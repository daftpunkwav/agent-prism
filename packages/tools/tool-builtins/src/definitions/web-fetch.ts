/**
 * @file tools/web-fetch
 * @description Builtin web_fetch tool: fetch a URL and return readable text.
 *
 * Responsibilities:
 * - Declare the tool's JSON schema
 * - Fetch http(s) pages through the SSRF-guarded safe-fetch seam (timeout, size caps)
 * - Strip HTML to plain text and bound oversized results via spill
 * - Surface the page title ahead of the body text
 */

import type { ToolArgs, ToolDefinition, ToolExecutionResult, ToolWorkspace } from "@agentprism/contracts";
import { UrlValidationError } from "@agentprism/contracts";
import { WorkspaceError } from "@agentprism/environment";
import { MAX_OUTPUT, readInt } from "./caps.js";
import { toolTuningValue } from "../tuning.js";
import { safeFetchText } from "./safe-fetch.js";
import { boundText } from "./spill.js";
import { asWorkspaceView } from "./workspace-view.js";

export const WEB_FETCH_JSON_SCHEMA: Record<string, unknown> = {
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
 * Decodes the six entities the text projection can meet. `&amp;` decodes last
 * so nested references (`&amp;lt;`) resolve exactly once per HTML semantics
 * instead of collapsing into the character they encode.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&");
}

/**
 * Converts HTML to readable text: scripts/styles/noscript removed, block tags
 * become line breaks, remaining tags stripped, entities and whitespace normalized.
 * Deliberately simple — the model reads a text projection, not a browser rendering.
 */
export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|article|header|footer|li|tr|h[1-6]|blockquote|pre)>/gi, "\n")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped)
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

/** Extracts the first <title>, entity-decoded and whitespace-collapsed; empty when absent. */
export function extractHtmlTitle(html: string): string {
  const raw = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
  const title = decodeEntities(raw.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return title === "" ? "" : title.length > 200 ? `${title.slice(0, 200)}…` : title;
}

async function executeWebFetch(
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
    let text = contentType.includes("html") ? htmlToText(raw) : raw.trim();
    if (contentType.includes("html")) {
      // A labeled title orients the model before it reads into body noise.
      const title = extractHtmlTitle(raw);
      if (title !== "") text = `Title: ${title}\n\n${text}`;
    }
    const maxLength = readInt(args, "max_length", toolTuningValue("maxOutputChars", MAX_OUTPUT));
    return { result: boundText(workspace, "web_fetch", text, maxLength), fileDiff: null, ok: true };
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

/** Builtin web_fetch tool definition. */
export const webFetchTool: ToolDefinition = {
  name: "web_fetch",
  description: "Fetch an http(s) URL and return its readable text content.",
  jsonSchema: WEB_FETCH_JSON_SCHEMA,
  mutatesWorkspace: false,
  get timeoutMs(): number {
    return toolTuningValue("webFetchTimeoutMs", FETCH_TIMEOUT_MS);
  },
  execute: executeWebFetch,
};
