/**
 * @file provider-types
 * @description Provider data contracts: endpoints, config, resolution rules.
 *
 * Responsibilities:
 * - Define endpoint entities and provider config with decode defaults
 * - Define the effective default-endpoint rule (enabled endpoints only)
 * - Define the served thinking-level set and the effective thinking-level rule
 */

import type { ThinkingBudgetPair } from "./provider.js";
import type { ThinkingMode } from "./enums.js";

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
  /** Vendor-defined thinking levels offered by this model; empty means the standard low/medium/high set. */
  thinking_levels: string[];
  /** Which thinking configuration applies: named-level mapping or the budget pair table (anthropic only). */
  thinking_mode: ThinkingMode;
  /** Budget-mode rows (level name → budget/output token pair); only consulted when thinking_mode is "budget". */
  thinking_budget_pairs: ThinkingBudgetPair[];
  /** Anthropic thinking budget in tokens (0 = unset: the level mapping applies). */
  thinking_budget_tokens: number;
  /** Total output cap that accompanies the budget (0 = unset: auto-raised to budget + 1024). Must exceed the budget. */
  thinking_max_tokens: number;
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

/**
 * The endpoint an empty endpoint_id resolves to: the stored default while it is
 * still enabled, else the first enabled endpoint. Disabled endpoints are a
 * settings-side off switch, so they neither anchor the default nor receive
 * fallback traffic — every surface that names a default (palette marker, arena
 * baseline defaults, runtime model resolution) must call this one function so
 * display and execution cannot disagree. When nothing is enabled the first
 * configured endpoint returns (possibly disabled), keeping the pinned-endpoint
 * fail-loud path at model construction intact.
 */
export function resolveDefaultEndpoint(config: ProviderConfig): LlmEndpoint | undefined {
  const enabled = config.endpoints.filter((endpoint) => endpoint.enabled !== false);
  return (
    enabled.find((endpoint) => endpoint.id === config.default_endpoint_id) ?? enabled[0] ?? config.endpoints[0]
  );
}

/**
 * Level names a levels-mode endpoint can serve: the custom list when configured,
 * else the standard low/medium/high set; a non-thinking endpoint serves none.
 * Single source for every surface that names the served set (level resolution,
 * baseline pin validation, baseline panel option projection) so they cannot
 * disagree about what an endpoint offers.
 */
export function servableThinkingLevels(
  endpoint: Pick<LlmEndpoint, "thinking_capable" | "thinking_levels">,
): string[] {
  const custom = endpoint.thinking_levels ?? [];
  return endpoint.thinking_capable ? (custom.length > 0 ? custom : ["low", "medium", "high"]) : [];
}

/**
 * Thinking level actually in effect for an endpoint: unsupported capability or
 * illegal levels resolve to off. The allowed set follows the endpoint's thinking
 * mode: budget mode consults the budget pair table's level names, level mode
 * uses the endpoint's served set (servableThinkingLevels). The result is a plain
 * string because custom levels are vendor-defined.
 */
export function effectiveThinkingLevel(
  endpoint: Pick<
    LlmEndpoint,
    "thinking_capable" | "thinking_level" | "thinking_levels" | "thinking_mode" | "thinking_budget_pairs"
  >,
  requested?: string | null,
): string {
  if (!endpoint.thinking_capable) return "off";
  const level = requested ?? endpoint.thinking_level;
  if (level === "off") return "off";
  const allowed =
    endpoint.thinking_mode === "budget"
      ? (endpoint.thinking_budget_pairs ?? []).map((pair) => pair.level)
      : servableThinkingLevels(endpoint);
  return allowed.includes(level) ? level : "off";
}
