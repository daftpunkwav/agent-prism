/**
 * @file provider-config
 * @description Provider config parsing, normalization, and public-view mapping.
 *
 * Responsibilities:
 * - Parse and normalize stored provider config
 * - Mask API keys in the public view
 * - Resolve the default endpoint and inherit empty keys by id or fingerprint
 */

import type { LlmEnvSeed } from "@agentprism/config";
import type { IdGenerator, LlmEndpoint, LlmEndpointUpdateInput, ProviderConfig, ProviderConfigPublic } from "@agentprism/contracts";
import { DEFAULT_WEBSITE_URL, DECODE_FIELD_RANGES, MAX_ENDPOINTS } from "@agentprism/contracts";
import { CREDENTIAL_REFERENCE_PATTERN, connectionFingerprint, normalizeModelIds, parseLlmEndpoint } from "./endpoints.js";

function clampDecodeValue(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

/** Legacy flat format (no endpoints) → single endpoint + models[] derived on the same connection. */
function legacyEndpointsFromTopLevel(raw: Record<string, unknown>, seed: LlmEnvSeed, ids: IdGenerator): LlmEndpoint[] {
  const base = parseLlmEndpoint(
    {
    id: ids.next(),
    label: "",
    provider_name: raw.provider_name ?? seed.providerName,
    api_key: raw.api_key ?? seed.apiKey,
    base_url: raw.base_url ?? seed.baseUrl,
    use_full_url: raw.use_full_url ?? true,
    api_format: raw.api_format ?? seed.apiFormat,
    auth_field: raw.auth_field ?? "ANTHROPIC_AUTH_TOKEN",
    model: raw.model ?? seed.model,
    context_window: raw.context_window,
    max_input_tokens: raw.max_input_tokens,
    max_output_tokens: raw.max_output_tokens,
    website_url: raw.website_url ?? "",
    thinking_capable: raw.thinking_capable === true,
    thinking_level: raw.thinking_level ?? "off",
    },
    ids,
  );
  const endpoints = [base];
  for (const model of normalizeModelIds(raw.models)) {
    if (model === base.model) continue;
    endpoints.push({ ...base, id: ids.next(), label: model, model });
  }
  return endpoints;
}

/** Endpoint parsing stage: new protocol / legacy flat migration / id dedup / same-connection model dedup. */
function parseEndpoints(raw: Record<string, unknown>, seed: LlmEnvSeed, ids: IdGenerator): LlmEndpoint[] {
  const rawEndpoints: unknown[] = Array.isArray(raw.endpoints) ? raw.endpoints : [];
  if (rawEndpoints.length > MAX_ENDPOINTS) {
    console.warn(`[providers] Endpoint count exceeds limit ${MAX_ENDPOINTS}; truncating ${rawEndpoints.length - MAX_ENDPOINTS}`);
  }
  let endpoints: LlmEndpoint[] = rawEndpoints.slice(0, MAX_ENDPOINTS).map((item) => parseLlmEndpoint(item, ids));
  if (endpoints.length === 0) {
    endpoints = legacyEndpointsFromTopLevel(raw, seed, ids).slice(0, MAX_ENDPOINTS);
  }

  // id dedup: duplicate ids get fresh ids
  const seenIds = new Set<string>();
  endpoints = endpoints.map((endpoint) => {
    if (seenIds.has(endpoint.id)) {
      return { ...endpoint, id: ids.next() };
    }
    seenIds.add(endpoint.id);
    return endpoint;
  });

  // Models must not repeat under the same connection
  const byConnection = new Map<string, Set<string>>();
  for (const endpoint of endpoints) {
    const fingerprint = connectionFingerprint(endpoint);
    let models = byConnection.get(fingerprint);
    if (models === undefined) {
      models = new Set();
      byConnection.set(fingerprint, models);
    }
    if (models.has(endpoint.model)) {
      throw new Error(`Duplicate model "${endpoint.model}" under the same request URL; merge endpoints or use a different model id`);
    }
    models.add(endpoint.model);
  }
  return endpoints;
}

/**
 * Parses and normalizes the provider config:
 * legacy format migration → endpoint field clamping → id dedup → same-connection
 * model dedup → default endpoint fallback → mirror field writeback → models derivation.
 * Structural problems (e.g. duplicate models on one connection) throw; the caller decides on fallback.
 */
export function parseProviderConfig(raw: unknown, seed: LlmEnvSeed, ids: IdGenerator): ProviderConfig {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const endpoints = parseEndpoints(source, seed, ids);

  const defaultEndpointId = endpoints.some((endpoint) => endpoint.id === source.default_endpoint_id)
    ? (source.default_endpoint_id as string)
    : endpoints[0]?.id ?? "";

  const config: ProviderConfig = {
    notes: typeof source.notes === "string" ? source.notes.slice(0, 500) : "",
    website_url: typeof source.website_url === "string" ? source.website_url.slice(0, 500) : DEFAULT_WEBSITE_URL,
    endpoints,
    default_endpoint_id: defaultEndpointId,
    // Clamp ranges derive from the contracts/DECODE_FIELD_RANGES single source — the same truth as the contract schema
    temperature: clampDecodeValue(source.temperature, DECODE_FIELD_RANGES.temperature.min, DECODE_FIELD_RANGES.temperature.max, seed.temperature),
    top_p: clampDecodeValue(source.top_p, DECODE_FIELD_RANGES.top_p.min, DECODE_FIELD_RANGES.top_p.max, 1.0),
    frequency_penalty: clampDecodeValue(source.frequency_penalty, DECODE_FIELD_RANGES.frequency_penalty.min, DECODE_FIELD_RANGES.frequency_penalty.max, 0.0),
    presence_penalty: clampDecodeValue(source.presence_penalty, DECODE_FIELD_RANGES.presence_penalty.min, DECODE_FIELD_RANGES.presence_penalty.max, 0.0),
    max_output_tokens: clampDecodeValue(source.max_output_tokens, DECODE_FIELD_RANGES.max_output_tokens.min, DECODE_FIELD_RANGES.max_output_tokens.max, 96000),
    provider_name: "",
    api_key: "",
    base_url: "",
    use_full_url: true,
    api_format: "anthropic_messages",
    auth_field: "ANTHROPIC_AUTH_TOKEN",
    model: "",
    models: [],
    context_window: 128_000,
    max_input_tokens: 120_000,
  };

  const defaultEndpoint = endpoints.find((endpoint) => endpoint.id === defaultEndpointId) ?? endpoints[0];
  if (defaultEndpoint !== undefined) {
    config.provider_name = defaultEndpoint.provider_name;
    config.api_key = defaultEndpoint.api_key;
    config.base_url = defaultEndpoint.base_url;
    config.use_full_url = defaultEndpoint.use_full_url;
    config.api_format = defaultEndpoint.api_format;
    config.auth_field = defaultEndpoint.auth_field;
    config.model = defaultEndpoint.model;
    config.context_window = defaultEndpoint.context_window;
    config.max_input_tokens = defaultEndpoint.max_input_tokens;
    if (defaultEndpoint.website_url !== "") {
      config.website_url = defaultEndpoint.website_url;
    }
  }
  config.models = endpoints
    .filter((endpoint) => endpoint.id !== config.default_endpoint_id)
    .map((endpoint) => endpoint.model);

  return config;
}

/** API key masking: empty stays empty; ≤8 chars always <short>; otherwise first/last 4. */
export function maskApiKey(apiKey: string): string {
  if (apiKey === "") return "";
  // A reference preview would otherwise leak the variable NAME (first/last 4
  // chars); references resolve at use time and are never secret themselves.
  if (CREDENTIAL_REFERENCE_PATTERN.test(apiKey.trim())) return "<env>";
  if (apiKey.length <= 8) return "<short>";
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

function toPublicEndpoint(endpoint: LlmEndpoint) {
  return {
    id: endpoint.id,
    label: endpoint.label,
    provider_name: endpoint.provider_name,
    api_key_set: endpoint.api_key !== "",
    api_key_preview: maskApiKey(endpoint.api_key),
    base_url: endpoint.base_url,
    use_full_url: endpoint.use_full_url,
    api_format: endpoint.api_format,
    auth_field: endpoint.auth_field,
    enabled: endpoint.enabled,
    model: endpoint.model,
    context_window: endpoint.context_window,
    max_input_tokens: endpoint.max_input_tokens,
    max_output_tokens: endpoint.max_output_tokens,
    website_url: endpoint.website_url,
    thinking_capable: endpoint.thinking_capable,
    thinking_level: endpoint.thinking_level,
    thinking_levels: Array.isArray(endpoint.thinking_levels) ? [...endpoint.thinking_levels] : [],
    image_input: endpoint.image_input,
    video_input: endpoint.video_input,
  };
}

/** Maps to the external public view (keys only return a masked preview). */
export function toPublicProviderConfig(config: ProviderConfig): ProviderConfigPublic {
  return {
    notes: config.notes,
    website_url: config.website_url,
    endpoints: config.endpoints.map(toPublicEndpoint),
    default_endpoint_id: config.default_endpoint_id,
    temperature: config.temperature,
    top_p: config.top_p,
    frequency_penalty: config.frequency_penalty,
    presence_penalty: config.presence_penalty,
    max_output_tokens: config.max_output_tokens,
    provider_name: config.provider_name,
    api_key_set: config.api_key !== "",
    api_key_preview: maskApiKey(config.api_key),
    base_url: config.base_url,
    use_full_url: config.use_full_url,
    api_format: config.api_format,
    auth_field: config.auth_field,
    model: config.model,
    models: config.models,
    context_window: config.context_window,
    max_input_tokens: config.max_input_tokens,
  };
}

/** Finds the default endpoint; falls back to the first one. */
export function resolveDefaultEndpoint(config: ProviderConfig): LlmEndpoint | undefined {
  return (
    config.endpoints.find((endpoint) => endpoint.id === config.default_endpoint_id) ?? config.endpoints[0]
  );
}

/**
 * Empty api_key inheritance: prefers the stored endpoint with the same id, then one
 * with the same connection fingerprint. Non-empty keys are kept as-is.
 */
export function mergeEndpointKeys<T extends { id: string; base_url: string; api_format: string; api_key: string }>(
  incoming: T[],
  existing: LlmEndpoint[],
): T[] {
  const byId = new Map(existing.map((endpoint) => [endpoint.id, endpoint]));
  const byFingerprint = new Map(existing.map((endpoint) => [connectionFingerprint(endpoint), endpoint]));
  return incoming.map((endpoint) => {
    if (endpoint.api_key !== "") return endpoint;
    const sameId = byId.get(endpoint.id);
    if (sameId !== undefined && sameId.api_key !== "") {
      return { ...endpoint, api_key: sameId.api_key };
    }
    const sameConnection = byFingerprint.get(connectionFingerprint(endpoint));
    if (sameConnection !== undefined && sameConnection.api_key !== "") {
      return { ...endpoint, api_key: sameConnection.api_key };
    }
    return endpoint;
  });
}

/** Endpoint update item → persisted entity (keeps the given id; generates one when absent). */
export function endpointUpdateToEntity(update: LlmEndpointUpdateInput, ids: IdGenerator): LlmEndpoint {
  return parseLlmEndpoint(
    {
      ...update,
      id: typeof update.id === "string" && update.id.trim() !== "" ? update.id : ids.next(),
    },
    ids,
  );
}
