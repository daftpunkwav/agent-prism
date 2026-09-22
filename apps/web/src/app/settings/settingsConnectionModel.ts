/**
 * @file settingsConnectionModel
 * @description Settings form model: flat endpoints grouped into connection groups.
 *
 * Responsibilities:
 * - Group flat endpoints into editable groups and flatten them back
 * - Provide blank factories and local-id helpers for form rows
 */

import type { LlmEndpointUpdate, ProviderConfig } from "@agentprism/client";

/** Displayed in place of a stored API key; never enters form state (empty means "keep stored"). */
export const API_KEY_SENTINEL = "****************";

/** A single model slot under one connection (matching one backend LlmEndpoint) */
export type ModelSlot = {
  id: string;
  label: string;
  model: string;
  context_window: number;
  max_input_tokens: number;
  max_output_tokens: number;
  thinking_capable: boolean;
  thinking_level: string;
  /** Vendor-defined thinking levels (OpenAI-compatible only); empty means the standard low/medium/high set. */
  thinking_levels: string[];
  image_input: boolean;
  video_input: boolean;
  enabled: boolean;
};

/** A connection group with fixed URL/key/format that can host multiple models */
export type ConnectionGroup = {
  key: string;
  provider_name: string;
  website_url: string;
  api_key: string;
  api_key_set?: boolean;
  base_url: string;
  use_full_url: boolean;
  api_format: string;
  auth_field: string;
  models: ModelSlot[];
};

export type SettingsForm = {
  notes: string;
  connections: ConnectionGroup[];
  default_endpoint_id: string;
  temperature: number;
  top_p: number;
  frequency_penalty: number;
  presence_penalty: number;
  max_output_tokens: number;
};

/** Fresh client-side id for unsaved connections/models (server assigns real ids). */
export function newLocalId(prefix = "new"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Frontend-locally generated model id not yet persisted ("m_" for blankModel's new slot, "new_" for newLocalId's fallback prefix); must be emptied before submitting to the backend to mean "create". */
export function isLocalModelId(id: string): boolean {
  return id.startsWith("m_") || id.startsWith("new_");
}

/**
 * Connection grouping key for display bucketing only (drift merely mis-buckets, never mis-routes keys).
 * Boundary constraint: apps/web may only import client/ui/arena-view, so this cannot reuse the backend
 * single source (connectionFingerprint in packages/providers/provider-capability/src/endpoints.ts). Keep the equivalence
 * contract instead of the implementation text: scheme + host case-insensitive, path/query/hash
 * case-sensitive, trailing slashes stripped, unparseable input fully lowercased, then `::<apiFormat>`.
 * Canonical vectors live in tests/provider-endpoints.test.ts (normalizeBaseUrl).
 */
function connKey(baseUrl: string, apiFormat: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  try {
    const parsed = new URL(trimmed);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`.replace(/\/+$/, "") + `::${apiFormat}`;
  } catch {
    return `${trimmed.toLowerCase()}::${apiFormat}`;
  }
}

/** Empty model slot with decoding defaults filled in. */
export function blankModel(): ModelSlot {
  return {
    id: newLocalId("m"),
    label: "",
    model: "",
    context_window: 128000,
    max_input_tokens: 120000,
    max_output_tokens: 2048,
    thinking_capable: false,
    thinking_level: "off",
    thinking_levels: [],
    image_input: false,
    video_input: false,
    enabled: true,
  };
}

/** Empty connection group with one blank model slot. */
export function blankConnection(): ConnectionGroup {
  return {
    key: newLocalId("c"),
    provider_name: "",
    website_url: "",
    api_key: "",
    base_url: "https://api.example.com/v1",
    use_full_url: true,
    api_format: "openai_chat",
    auth_field: "Authorization",
    models: [blankModel()],
  };
}

/** Aggregates flat endpoints into connection groups by (base_url, api_format) */
export function groupEndpoints(cfg: ProviderConfig): ConnectionGroup[] {
  const list = cfg.endpoints ?? [];
  if (list.length === 0) {
    const c = blankConnection();
    c.provider_name = cfg.provider_name || "";
    c.base_url = cfg.base_url;
    c.use_full_url = cfg.use_full_url;
    c.api_format = cfg.api_format;
    c.auth_field = cfg.auth_field;
    c.website_url = cfg.website_url || "";
    c.api_key_set = cfg.api_key_set;
    c.models = [
      {
        id: "legacy",
        label: "",
        model: cfg.model,
        context_window: cfg.context_window,
        max_input_tokens: cfg.max_input_tokens,
        max_output_tokens: cfg.max_output_tokens,
        thinking_capable: false,
        thinking_level: "off",
        thinking_levels: [],
        image_input: false,
        video_input: false,
        enabled: true,
      },
    ];
    return [c];
  }

  const order: string[] = [];
  const map = new Map<string, ConnectionGroup>();
  for (const ep of list) {
    const k = connKey(ep.base_url, ep.api_format);
    let g = map.get(k);
    if (!g) {
      g = {
        key: k,
        provider_name: ep.provider_name ?? "",
        website_url: ep.website_url || cfg.website_url || "",
        api_key: "",
        api_key_set: ep.api_key_set,
        base_url: ep.base_url,
        use_full_url: ep.use_full_url ?? true,
        api_format: ep.api_format,
        auth_field: ep.auth_field,
        models: [],
      };
      map.set(k, g);
      order.push(k);
    } else if (ep.api_key_set) {
      g.api_key_set = true;
    }
    if (!g.website_url && ep.website_url) g.website_url = ep.website_url;
    if (!g.provider_name && ep.provider_name) g.provider_name = ep.provider_name;
    g.models.push({
      id: ep.id,
      label: ep.label ?? "",
      model: ep.model,
      context_window: ep.context_window ?? 128000,
      max_input_tokens: ep.max_input_tokens ?? 120000,
      max_output_tokens: ep.max_output_tokens ?? 2048,
      thinking_capable: !!ep.thinking_capable,
      image_input: !!ep.image_input,
      video_input: !!ep.video_input,
      enabled: ep.enabled !== false,
      // The public view is a string; illegal values are rejected by the backend zod — pass through, storage clamps
      thinking_level: ep.thinking_level || "off",
      thinking_levels: Array.isArray(ep.thinking_levels) ? ep.thinking_levels.filter((l): l is string => typeof l === "string") : [],
    });
  }
  const groups: ConnectionGroup[] = [];
  for (const k of order) {
    const g = map.get(k);
    // order and map are appended together above; the guard keeps it total without an assertion.
    if (g !== undefined) groups.push(g);
  }
  return groups;
}

/** Flattens connection groups into endpoint update items; the return type enforces field-by-field, so a contract field missing here is a compile error. */
export function flattenConnections(connections: ConnectionGroup[]): LlmEndpointUpdate[] {
  const endpoints: LlmEndpointUpdate[] = [];
  for (const c of connections) {
    for (const m of c.models) {
      if (!m.model.trim()) continue;
      endpoints.push({
        id: isLocalModelId(m.id) ? "" : m.id,
        label: m.label,
        provider_name: c.provider_name,
        api_key: c.api_key,
        base_url: c.base_url,
        use_full_url: c.use_full_url,
        api_format: c.api_format,
        auth_field: c.auth_field,
        model: m.model.trim(),
        context_window: m.context_window,
        max_input_tokens: m.max_input_tokens,
        max_output_tokens: m.max_output_tokens,
        website_url: c.website_url,
        thinking_capable: m.thinking_capable,
        image_input: m.image_input,
        video_input: m.video_input,
        thinking_level: m.thinking_capable ? m.thinking_level : "off",
        thinking_levels: m.thinking_levels.filter((l) => l.trim() !== ""),
        enabled: m.enabled !== false,
      });
    }
  }
  return endpoints;
}
