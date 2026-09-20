/**
 * @file tools/web-search
 * @description Builtin web_search tool: keyed-provider web search behind a local seam.
 *
 * Responsibilities:
 * - Declare the tool's JSON schema (query + count)
 * - Route to one REST search backend selected by env (no SDK dependencies)
 * - Fail closed with a setup hint when no provider is configured
 *
 * Localized DSH web-search (exa/perplexity/deepseek backends): plain fetch against
 * Exa or Tavily keeps the model-visible schema stable while backends stay swappable.
 * No key on the box means no search: the tool reports how to enable itself instead
 * of pretending (judging grounding stays absent until an operator opts in).
 */

import type { ToolArgs, ToolDefinition, ToolExecutionResult, ToolWorkspace } from "@agentprism/contracts";
import { WorkspaceError } from "@agentprism/environment";
import { toolTuningValue } from "../tuning.js";
import { readInt } from "./caps.js";
import { boundText } from "./spill.js";

export const WEB_SEARCH_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    query: { type: "string", description: "Search query" },
    count: { type: "integer", description: "Max results, 1-10 (default 5)" },
  },
  required: ["query"],
  additionalProperties: false,
};

const SEARCH_TIMEOUT_MS = 15_000;
const DEFAULT_COUNT = 5;
const MAX_COUNT = 10;
/** Per-result snippet budget before the shared whole-output cap applies. */
const SNIPPET_CHARS = 600;

const EXA_URL = "https://api.exa.ai/search";
const TAVILY_URL = "https://api.tavily.com/search";

/** Environment seam: where the search config is read from (tests inject a snapshot). */
export type WebSearchEnvReader = () => Record<string, string | undefined>;

let readEnv: WebSearchEnvReader = () => process.env;

/** Overrides where the search config is read from; null resets to process.env. */
export function setWebSearchEnvReader(reader: WebSearchEnvReader | null): void {
  readEnv = reader ?? (() => process.env);
}

interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

function setupHint(provider: string): string {
  return `Error: web_search is not configured (SEARCH_PROVIDER=${provider || "<unset>"}). Set SEARCH_PROVIDER=exa|tavily plus SEARCH_API_KEY to enable; judging grounding stays absent until then.`;
}

function oneLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeExa(payload: unknown): SearchHit[] {
  if (typeof payload !== "object" || payload === null || !Array.isArray((payload as { results?: unknown }).results)) {
    throw new WorkspaceError("Error: search backend returned an unexpected shape");
  }
  return ((payload as { results: unknown[] }).results).map((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    return { title: oneLine(item.title), url: oneLine(item.url), snippet: oneLine(item.text ?? item.snippet) };
  });
}

function normalizeTavily(payload: unknown): SearchHit[] {
  if (typeof payload !== "object" || payload === null || !Array.isArray((payload as { results?: unknown }).results)) {
    throw new WorkspaceError("Error: search backend returned an unexpected shape");
  }
  return ((payload as { results: unknown[] }).results).map((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    return { title: oneLine(item.title), url: oneLine(item.url), snippet: oneLine(item.content ?? item.snippet) };
  });
}

async function executeWebSearch(
  workspace: ToolWorkspace,
  args: ToolArgs,
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  const query = String(args.query ?? "").trim();
  if (query === "") {
    return { result: "Error: query must be a non-empty string", fileDiff: null, ok: false, code: "workspace_error" };
  }
  const env = readEnv();
  const provider = String(env.SEARCH_PROVIDER ?? "").trim().toLowerCase();
  if (provider !== "exa" && provider !== "tavily") {
    return { result: setupHint(provider), fileDiff: null, ok: false, code: "workspace_error" };
  }
  const apiKey = String(env.SEARCH_API_KEY ?? "").trim();
  if (apiKey === "") {
    return { result: setupHint(provider), fileDiff: null, ok: false, code: "workspace_error" };
  }
  const count = Math.min(MAX_COUNT, Math.max(1, readInt(args, "count", DEFAULT_COUNT)));
  const endpoint = String(env.SEARCH_API_URL ?? "").trim() || (provider === "exa" ? EXA_URL : TAVILY_URL);
  const body =
    provider === "exa"
      ? { query, numResults: count }
      : { api_key: apiKey, query, max_results: count, include_answer: false, search_depth: "basic" };
  const headers: Record<string, string> =
    provider === "exa"
      ? { "content-type": "application/json", "x-api-key": apiKey }
      : { "content-type": "application/json" };
  const timeoutMs = toolTuningValue("webSearchTimeoutMs", SEARCH_TIMEOUT_MS);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const linked = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  let response: Response;
  try {
    response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: linked });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { result: "Error: search timed out", fileDiff: null, ok: false, code: "workspace_error" };
    }
    return { result: `Error: search request failed (${error instanceof Error ? error.message : String(error)})`, fileDiff: null, ok: false, code: "workspace_error" };
  }
  if (!response.ok) {
    return { result: `Error: search backend HTTP ${response.status}`, fileDiff: null, ok: false, code: "workspace_error" };
  }
  try {
    const payload: unknown = await response.json();
    const hits = (provider === "exa" ? normalizeExa : normalizeTavily)(payload).slice(0, count);
    if (hits.length === 0) return { result: "(no results)", fileDiff: null, ok: true };
    const lines = hits.map((hit, index) => {
      const title = hit.title !== "" ? hit.title : hit.url;
      const snippet = hit.snippet.length > SNIPPET_CHARS ? `${hit.snippet.slice(0, SNIPPET_CHARS)}…` : hit.snippet;
      return `${index + 1}. ${title}\n   ${hit.url}${snippet !== "" ? `\n   ${snippet}` : ""}`;
    });
    return { result: boundText(workspace, "web_search", lines.join("\n")), fileDiff: null, ok: true };
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return { result: error.message, fileDiff: null, ok: false, code: "workspace_error" };
    }
    return { result: `Error: unreadable search response (${error instanceof Error ? error.message : String(error)})`, fileDiff: null, ok: false, code: "workspace_error" };
  }
}

/** Builtin web_search tool definition. */
export const webSearchTool: ToolDefinition = {
  name: "web_search",
  description:
    "Web search via the configured provider (SEARCH_PROVIDER=exa|tavily plus SEARCH_API_KEY). Fail-closed when unconfigured: set the env vars to enable grounding.",
  jsonSchema: WEB_SEARCH_JSON_SCHEMA,
  mutatesWorkspace: false,
  get timeoutMs(): number {
    return toolTuningValue("webSearchTimeoutMs", SEARCH_TIMEOUT_MS);
  },
  execute: executeWebSearch,
};
