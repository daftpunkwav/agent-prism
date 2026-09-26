/**
 * @file endpoint
 * @description Anthropic transport facts the Claude Code CLI needs for a column.
 *
 * Responsibilities:
 * - Read base URL / API key / model off the configured vendor chat model
 * - Fail fast with an actionable message when the column is not Anthropic-format
 *
 * The Claude Code CLI talks to the model itself (unlike the AutoGen/CrewAI
 * bridges, which round-trip completions to the host), so it needs the endpoint
 * and credential explicitly. The Arena builds Anthropic-format columns as a
 * LangChain ChatAnthropic — the contracts' designated vendor escape hatch — and
 * that instance carries exactly these three facts.
 */

import { ConfigurationError } from "@agentprism/contracts";

/** Transport facts for one Claude Code subprocess. */
export interface ClaudeTransport {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Minimal structural view of the ChatAnthropic instance (no LC dependency here). */
interface VendorLike {
  model?: unknown;
  apiKey?: unknown;
  clientOptions?: { baseURL?: unknown } | undefined;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Resolves the transport for the column's configured model.
 *
 * @param llmVendor ColumnRuntime.llmVendor (a ChatAnthropic for Anthropic-format providers).
 * @param fallbackModel Column model id, used when the vendor instance carries none.
 * @throws ConfigurationError when the column does not resolve to an Anthropic endpoint/credential.
 */
export function resolveClaudeTransport(llmVendor: unknown, fallbackModel: string): ClaudeTransport {
  const vendor = (llmVendor ?? {}) as VendorLike;
  const baseUrl = readString(vendor.clientOptions?.baseURL);
  const apiKey = readString(vendor.apiKey);
  const model = readString(vendor.model) || readString(fallbackModel);
  if (baseUrl === "") {
    throw new ConfigurationError(
      "Claude Agent SDK needs an Anthropic-format provider endpoint: the CLI authenticates against " +
        "the endpoint itself. Select a provider whose api_format is anthropic_messages for this column",
    );
  }
  if (apiKey === "") {
    throw new ConfigurationError(
      "Claude Agent SDK needs the column's provider API Key: set it in Provider settings first",
    );
  }
  if (model === "") {
    throw new ConfigurationError("Claude Agent SDK needs a model id: set one on the column or its endpoint");
  }
  return { baseUrl, apiKey, model };
}

/** Env overrides that would redirect the CLI away from the column's endpoint. */
const CONFLICTING_ENV_KEYS = [
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "ANTHROPIC_VERTEX_BASE_URL",
] as const;

/**
 * Builds the subprocess environment. The SDK replaces the child environment
 * outright, so process.env is spread explicitly; conflicting credential and
 * provider overrides are dropped so the column always runs on its own endpoint.
 */
export function claudeSubprocessEnv(
  transport: ClaudeTransport,
  parent: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parent)) {
    if (typeof value === "string") env[key] = value;
  }
  for (const key of CONFLICTING_ENV_KEYS) delete env[key];
  env["ANTHROPIC_BASE_URL"] = transport.baseUrl;
  env["ANTHROPIC_API_KEY"] = transport.apiKey;
  env["ANTHROPIC_MODEL"] = transport.model;
  return env;
}
