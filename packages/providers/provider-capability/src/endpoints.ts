/**
 * @file endpoints
 * @description Endpoint parsing and normalization from arbitrary JSON fragments.
 *
 * Responsibilities:
 * - Clamp and normalize base URLs and model id lists
 * - Whitelist thinking levels and generate missing ids
 * - Compute connection fingerprints for key inheritance
 */

import type { IdGenerator, LlmEndpoint } from "@agentprism/contracts";
import { DEFAULT_LLM_BASE_URL, DEFAULT_MODEL_ID, ThinkingLevelSchema } from "@agentprism/contracts";

/**
 * Credential reference syntax: the whole value must be `${env:NAME}` (env names
 * limited to shell-safe identifiers). Partial interpolation is deliberately
 * unsupported: predictable full-value resolution never surprises URL builders.
 */
export const CREDENTIAL_REFERENCE_PATTERN = /^\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/;

/** Default secret lookup reads process.env (mirrors config loadSettings). */
export function defaultEnvLookup(name: string): string | undefined {
  return process.env[name];
}

/**
 * Resolves a `${env:NAME}` credential reference through lookup; every other
 * value (including malformed references) passes through untouched so typos
 * surface as ordinary auth failures instead of magic empty strings. A missing
 * variable resolves to "" so downstream empty-key guards fail closed.
 */
export function resolveCredentialReference(
  value: string,
  lookup: (name: string) => string | undefined = defaultEnvLookup,
): string {
  const match = CREDENTIAL_REFERENCE_PATTERN.exec(value.trim());
  if (match === null) return value;
  return lookup(match[1] ?? "") ?? "";
}

/**
 * Normalizes a base URL for connection fingerprinting: trims, strips trailing
 * slashes, lowercases scheme + host only. Path/query stay case-sensitive per RFC,
 * so two gateways differing only in path case never share a fingerprint (and a key
 * is never inherited across them).
 */
export function normalizeBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, "");
  try {
    const parsed = new URL(trimmed);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`.replace(/\/+$/, "");
  } catch {
    return trimmed.toLowerCase();
  }
}

/** Trim, drop empties, dedupe (order-preserving). */
export function normalizeModelIds(models: unknown): string[] {
  if (!Array.isArray(models)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of models) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed === "" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

const ENDPOINT_ID_MAX = 64;
const STRING_MAX = { label: 100, provider_name: 100, api_key: 4096, base_url: 500, auth_field: 100, model: 200, website_url: 500 };
const TOKEN_LIMITS = {
  context_window: { min: 1024, max: 10_000_000, fallback: 128_000 },
  max_input_tokens: { min: 256, max: 10_000_000, fallback: 120_000 },
  max_output_tokens: { min: 64, max: 128_000, fallback: 96000 },
};

function readString(source: Record<string, unknown>, key: string, fallback: string, maxLength: number): string {
  const raw = source[key];
  const value = typeof raw === "string" ? raw : "";
  return value.slice(0, maxLength) || fallback;
}

function clampInt(value: unknown, limits: { min: number; max: number; fallback: number }): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return limits.fallback;
  return Math.min(limits.max, Math.max(limits.min, Math.trunc(num)));
}

/** Parses an endpoint from an arbitrary JSON fragment; missing ids are generated, out-of-range fields clamped. */
export function parseLlmEndpoint(raw: unknown, ids: IdGenerator): LlmEndpoint {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const id = (typeof source.id === "string" ? source.id.trim().slice(0, ENDPOINT_ID_MAX) : "") || ids.next();
  return {
    id,
    label: readString(source, "label", "", STRING_MAX.label),
    provider_name: readString(source, "provider_name", "", STRING_MAX.provider_name),
    api_key: readString(source, "api_key", "", STRING_MAX.api_key),
    base_url: readString(source, "base_url", DEFAULT_LLM_BASE_URL, STRING_MAX.base_url),
    use_full_url: source.use_full_url !== false,
    api_format: source.api_format === "openai_chat" ? "openai_chat" : "anthropic_messages",
    auth_field: readString(source, "auth_field", "ANTHROPIC_AUTH_TOKEN", STRING_MAX.auth_field),
    model: (typeof source.model === "string" && source.model.trim() !== "" ? source.model.trim() : DEFAULT_MODEL_ID).slice(0, STRING_MAX.model),
    context_window: clampInt(source.context_window, TOKEN_LIMITS.context_window),
    max_input_tokens: clampInt(source.max_input_tokens, TOKEN_LIMITS.max_input_tokens),
    max_output_tokens: clampInt(source.max_output_tokens, TOKEN_LIMITS.max_output_tokens),
    website_url: readString(source, "website_url", "", STRING_MAX.website_url),
    thinking_capable: source.thinking_capable === true,
    image_input: source.image_input === true,
    video_input: source.video_input === true,
    // Absent or non-boolean keeps the endpoint enabled: hand-edited configs from
    // before the flag existed must not silently lose their models.
    enabled: source.enabled !== false,
    // Same level whitelist normalization on read and write sides: illegal levels fall to off, so a hand-edited config file
    // never ends up "UI echoes the raw value while thinking params are silently absent". Effectiveness still gates on
    // the consumer-side effectiveThinkingLevel.
    thinking_level: ThinkingLevelSchema.catch("off").parse(source.thinking_level),
  };
}

/** Connection fingerprint: the same (base_url, api_format) counts as one endpoint connection. */
export function connectionFingerprint(endpoint: Pick<LlmEndpoint, "base_url" | "api_format">): string {
  return `${normalizeBaseUrl(endpoint.base_url)}::${endpoint.api_format}`;
}
