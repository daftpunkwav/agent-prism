/**
 * @file provider-mapping
 * @description Maps public provider views back to update payloads.
 *
 * Responsibilities:
 * - Own the single source of the saved field list on Arena's save path
 * - Make a missing contract field a compile error via the full update return type
 *
 * The Settings form path builds payloads from form state instead; the shared
 * return type keeps both aligned at compile time.
 */

import type { LlmEndpointPublic, LlmEndpointUpdate, ProviderConfigUpdate } from "@agentprism/contracts";
import type { ProviderConfig } from "./types";

/** Endpoint round-trip. ``api_key: ""`` semantics = backend keeps the stored key by id. */
export function endpointUpdateFromPublic(endpoint: LlmEndpointPublic): LlmEndpointUpdate {
  return {
    id: endpoint.id,
    label: endpoint.label,
    provider_name: endpoint.provider_name,
    api_key: "",
    base_url: endpoint.base_url,
    use_full_url: endpoint.use_full_url,
    api_format: endpoint.api_format,
    auth_field: endpoint.auth_field,
    model: endpoint.model,
    context_window: endpoint.context_window,
    max_input_tokens: endpoint.max_input_tokens,
    max_output_tokens: endpoint.max_output_tokens,
    website_url: endpoint.website_url,
    thinking_capable: endpoint.thinking_capable,
    // The public view is a string; storage clamps it to the enum — a single-point assertion narrows it here
    thinking_level: endpoint.thinking_level as LlmEndpointUpdate["thinking_level"],
    image_input: endpoint.image_input,
    video_input: endpoint.video_input,
    enabled: endpoint.enabled,
  };
}

/** Round-trips the full public view as a complete update payload; overrides only cover fields explicitly being changed (e.g. decode defaults). */
export function providerUpdateFromPublic(
  config: ProviderConfig,
  overrides: Partial<ProviderConfigUpdate> = {},
): ProviderConfigUpdate {
  return {
    notes: config.notes,
    website_url: config.website_url,
    default_endpoint_id: config.default_endpoint_id,
    temperature: config.temperature,
    top_p: config.top_p,
    frequency_penalty: config.frequency_penalty,
    presence_penalty: config.presence_penalty,
    max_output_tokens: config.max_output_tokens,
    provider_name: config.provider_name,
    base_url: config.base_url,
    use_full_url: config.use_full_url,
    api_format: config.api_format,
    auth_field: config.auth_field,
    model: config.model,
    models: config.models,
    context_window: config.context_window,
    max_input_tokens: config.max_input_tokens,
    api_key: "",
    test_endpoint_id: "",
    endpoints: (config.endpoints ?? []).map(endpointUpdateFromPublic),
    ...overrides,
  };
}
