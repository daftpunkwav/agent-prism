/**
 * @file provider-types
 * @description Provider data contracts: endpoints, config, thinking-level resolution.
 *
 * Responsibilities:
 * - Define endpoint entities and provider config with decode defaults
 * - Define the effective thinking-level rule (endpoint overrides top-level)
 */

import type { ThinkingLevel } from "./enums.js";

/** Endpoint entity (pure data contract, no IO). */
export interface LlmEndpoint {
  id: string;
  label: string;
  provider_name: string;
  api_key: string;
  base_url: string;
  use_full_url: boolean;
  api_format: string;
  auth_field: string;
  model: string;
  context_window: number;
  max_input_tokens: number;
  max_output_tokens: number;
  website_url: string;
  thinking_capable: boolean;
  image_input: boolean;
  video_input: boolean;
  /** Disabled endpoints are excluded from the model dimension options and refused at model construction. */
  enabled: boolean;
  thinking_level: string;
}

/** Provider config entity: endpoint collection + shared decode defaults + top-level legacy mirror fields. */
export interface ProviderConfig {
  notes: string;
  website_url: string;
  endpoints: LlmEndpoint[];
  default_endpoint_id: string;
  temperature: number;
  top_p: number;
  frequency_penalty: number;
  presence_penalty: number;
  max_output_tokens: number;
  /** Mirror compatibility fields for the default endpoint (legacy clients / legacy file format). */
  provider_name: string;
  api_key: string;
  base_url: string;
  use_full_url: boolean;
  api_format: string;
  auth_field: string;
  model: string;
  /** Derived field: model ids of non-default endpoints. */
  models: string[];
  context_window: number;
  max_input_tokens: number;
}

/** Thinking level actually in effect for an endpoint: unsupported capability or illegal levels resolve to off. */
export function effectiveThinkingLevel(
  endpoint: Pick<LlmEndpoint, "thinking_capable" | "thinking_level">,
  requested?: string | null,
): ThinkingLevel {
  if (!endpoint.thinking_capable) return "off";
  const level = requested ?? endpoint.thinking_level;
  return level === "low" || level === "medium" || level === "high" ? level : "off";
}
