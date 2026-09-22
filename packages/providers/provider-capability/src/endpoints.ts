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
import { DEFAULT_LLM_BASE_URL, DEFAULT_MODEL_ID } from "@agentprism/contracts";

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

/**
 * Terminal request paths the SDKs append themselves. When the operator pastes
 * a full request URL with "full URL" checked, the suffix is stripped so the
 * stored value stays a base URL (double-appending otherwise 404s). Only exact
 * terminal segments strip: a gateway path that merely contains these words is
 * left untouched.
 */
const TERMINAL_API_PATHS = ["/chat/completions", "/responses", "/messages"];

function stripTerminalApiPath(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  for (const suffix of TERMINAL_API_PATHS) {
    if (trimmed === suffix || trimmed.endsWith(suffix)) {
      const stripped = trimmed.slice(0, trimmed.length - suffix.length).replace(/\/+$/, "");
      if (stripped !== "") return stripped;
    }
  }
  return baseUrl;
}

/** Vendor thinking-level hygiene: trim, drop empties, dedupe (order-preserving), cap count. */
export function normalizeThinkingLevels(levels: unknown): string[] {
  if (!Array.isArray(levels)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of levels) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim().slice(0, 32);
    if (trimmed === "" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
    if (result.length >= 16) break;
  }
  return result;
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
  const useFullUrl = source.use_full_url !== false;
  const baseUrl = readString(source, "base_url", DEFAULT_LLM_BASE_URL, STRING_MAX.base_url);
  const apiFormat = source.api_format === "openai_chat" || source.api_format === "openai_responses" ? source.api_format : "anthropic_messages";
  // Effectiveness still gates on the consumer-side effectiveThinkingLevel: parse
  // only coerces unlisted selections to off so hand-edited configs stay runnable.
  const thinkingLevels = normalizeThinkingLevels(source.thinking_levels);
  const allowedLevels =
    thinkingLevels.length > 0 && (apiFormat === "openai_chat" || apiFormat === "openai_responses")
      ? thinkingLevels
      : ["low", "medium", "high"];
  const thinkingLevel = readString(source, "thinking_level", "off", 32);
  return {
    id,
    label: readString(source, "label", "", STRING_MAX.label),
    provider_name: readString(source, "provider_name", "", STRING_MAX.provider_name),
    api_key: readString(source, "api_key", "", STRING_MAX.api_key),
    base_url: useFullUrl ? stripTerminalApiPath(baseUrl) : baseUrl,
    use_full_url: useFullUrl,
    api_format: apiFormat,
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
    // never ends up "UI echoes the raw value while thinking params are silently absent".
    thinking_level: thinkingLevel === "off" || allowedLevels.includes(thinkingLevel) ? thinkingLevel : "off",
    thinking_levels: thinkingLevels,
  };
}

/** Connection fingerprint: the same (base_url, api_format) counts as one endpoint connection. */
export function connectionFingerprint(endpoint: Pick<LlmEndpoint, "base_url" | "api_format">): string {
  return `${normalizeBaseUrl(endpoint.base_url)}::${endpoint.api_format}`;
}
