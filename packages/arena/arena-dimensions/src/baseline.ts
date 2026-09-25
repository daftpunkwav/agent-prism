/**
 * @file baseline
 * @description Baseline resolution and per-column pipeline construction.
 *
 * Responsibilities:
 * - Resolve baseline overrides, skipping the compared dimension's own field
 * - Merge model_id into endpoint_id for uniform resolution
 * - Build each column's PipelineConfig from baseline + endpoint + overrides
 */

import type { BaselineOverrides, LlmEndpoint, PipelineConfig, ProviderConfig, ProviderLookup } from "@agentprism/contracts";
import {
  effectiveThinkingLevel,
  MAX_OUTPUT_TOKENS_OPTIONS,
  PENALTY_OPTIONS,
  TEMPERATURE_OPTIONS,
  TOP_P_OPTIONS,
} from "@agentprism/contracts";
import type { DimensionId } from "@agentprism/contracts";
import { DIMENSION_FIELD, type DimensionCatalog } from "@agentprism/dimensions";
import { coerceFieldValue, normalizeOptionToken, snapIntToOptions, snapToOptions } from "./field-values.js";

export interface BaselineResolverDeps {
  provider: ProviderConfig;
  providerLookup: ProviderLookup;
  dimensionCatalog: DimensionCatalog;
}

/**
 * Resolves baseline overrides:
 * skips the compared dimension's own field → merges model_id into endpoint_id
 * (throws when no match) → throws on unknown fields / illegal values.
 */
export function resolveBaselineOverrides(
  dimension: DimensionId,
  baseline: BaselineOverrides | null | undefined,
  deps: BaselineResolverDeps,
): Record<string, unknown> {
  if (baseline === null || baseline === undefined) return {};
  const raw: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(baseline)) {
    if (value !== null && value !== undefined) raw[key] = value;
  }

  if ("model_id" in raw) {
    // Same policy as unknown fields / illegal values: a baseline naming a nonexistent model must fail loudly, never be silently ignored
    const modelId = String(raw.model_id);
    delete raw.model_id;
    if (!("endpoint_id" in raw)) {
      const catalogEndpoints = deps.providerLookup.listEndpoints();
      const pool = catalogEndpoints.length > 0 ? catalogEndpoints : deps.provider.endpoints;
      const matched = pool.find((endpoint) => endpoint.model === modelId);
      if (matched === undefined) {
        throw new Error(`Baseline model_id "${modelId}" has no matching endpoint`);
      }
      raw.endpoint_id = matched.id;
    } else {
      // Both keys given: the endpoint wins, but a model naming a different endpoint's model
      // is a caller contradiction, not a preference — fail loudly instead of dropping model_id.
      // (An unknown endpoint_id is still reported downstream by buildPipelineBase.)
      const pinned = deps.providerLookup.lookupEndpoint(String(raw.endpoint_id), deps.provider);
      if (pinned !== undefined && pinned.model !== modelId) {
        throw new Error(
          `Baseline model_id "${modelId}" conflicts with endpoint_id "${String(raw.endpoint_id)}" (serves model "${pinned.model}")`,
        );
      }
    }
  }

  const lockedField = DIMENSION_FIELD[dimension];
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === lockedField) continue;
    // Column label is an identity pin (threads), not a comparison variable: pass through
    // without dimension-catalog validation; buildPipelineBase applies it verbatim.
    if (key === "label") {
      resolved.label = String(value);
      continue;
    }
    if (!deps.dimensionCatalog.isKnownField(key)) {
      throw new Error(`Baseline does not support field: ${key}`);
    }
    const token = normalizeOptionToken(key, value);
    if (!deps.dimensionCatalog.isLegalFieldValue(key, token)) {
      throw new Error(`Baseline field "${key}" has unsupported value: ${String(value)}`);
    }
    resolved[key] = coerceFieldValue(key, token);
  }
  return resolved;
}

/**
 * Builds one column's PipelineConfig from baseline defaults + endpoint resolution + overrides.
 * An endpoint_id override cascades into model_id/thinking capability; model_id has already
 * been merged into endpoint_id by resolveBaselineOverrides.
 */
export function buildPipelineBase(
  deps: BaselineResolverDeps,
  overrides: Record<string, unknown>,
): PipelineConfig {
  const { provider, providerLookup, dimensionCatalog } = deps;
  const base = dimensionCatalog.defaultBaseValues;

  const requestedEndpointId = (overrides.endpoint_id as string | undefined) ?? (base.endpoint_id as string | undefined);
  let endpoint: LlmEndpoint | undefined = providerLookup.lookupEndpoint(requestedEndpointId ?? "", provider);
  if (endpoint === undefined) {
    // An explicitly requested endpoint that no longer exists must fail loudly (same policy as model_id above), never silently run on endpoints[0].
    if (requestedEndpointId !== undefined && requestedEndpointId !== "") {
      throw new Error(`Baseline endpoint_id "${requestedEndpointId}" has no matching endpoint`);
    }
    endpoint = provider.endpoints[0];
  }
  if (endpoint === undefined) {
    throw new Error("No endpoints configured");
  }

  const data: Record<string, unknown> = {
    framework: base.framework ?? "native",
    reasoning: base.reasoning ?? "react",
    context: base.context ?? "sliding",
    harness: base.harness ?? "bare",
    prompt_profile: base.prompt_profile ?? "zero_shot",
    prompt_version: base.prompt_version ?? "v1.0.0",
    max_steps: base.max_steps ?? 10,
    toolset: base.toolset ?? "full",
    mcp_policy: base.mcp_policy ?? "off",
    skill_policy: base.skill_policy ?? "on_demand",
    approval_mode: base.approval_mode ?? "auto",
    sandbox_mode: base.sandbox_mode ?? "off",
    orchestration: base.orchestration ?? "direct",
    memory: base.memory ?? "none",
    history_mode: base.history_mode ?? "minimal",
    endpoint_id: endpoint.id,
    model_id: endpoint.model,
    thinking_capable: endpoint.thinking_capable,
    thinking_level: effectiveThinkingLevel(endpoint, String(base.thinking_level ?? "off")),
    temperature: Number(base.temperature ?? snapToOptions(provider.temperature, TEMPERATURE_OPTIONS)),
    top_p: Number(base.top_p ?? snapToOptions(provider.top_p, TOP_P_OPTIONS)),
    frequency_penalty: Number(base.frequency_penalty ?? snapToOptions(provider.frequency_penalty, PENALTY_OPTIONS)),
    presence_penalty: Number(base.presence_penalty ?? snapToOptions(provider.presence_penalty, PENALTY_OPTIONS)),
    max_output_tokens: Math.trunc(
      Number(base.max_output_tokens ?? snapIntToOptions(provider.max_output_tokens, MAX_OUTPUT_TOKENS_OPTIONS)),
    ),
    label: "",
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (key === "label") {
      data.label = String(value);
      continue;
    }
    if (key === "endpoint_id") {
      const requested = String(value);
      const lookedUp = providerLookup.lookupEndpoint(requested, provider);
      if (requested !== "" && lookedUp === undefined) {
        throw new Error(`Baseline endpoint_id "${requested}" has no matching endpoint`);
      }
      const matched: LlmEndpoint | undefined = lookedUp ?? endpoint;
      endpoint = matched;
      data.endpoint_id = matched.id;
      data.model_id = matched.model;
      data.thinking_capable = matched.thinking_capable;
      continue;
    }
    if (key === "thinking_level") {
      continue;
    }
    data[key] = coerceFieldValue(key, value);
  }

  const requestedLevel = String(overrides.thinking_level ?? data.thinking_level ?? "off");
  if (endpoint !== undefined) {
    data.thinking_capable = endpoint.thinking_capable;
    data.thinking_level = effectiveThinkingLevel(endpoint, requestedLevel);
  }
  return toPipelineConfig(data);
}

/**
 * Picks PipelineConfig fields one by one from the merged field record.
 * Key legality is guaranteed by upstream defaults and runtime validation; the inline
 * casts here only trust already-converged values.
 */
function toPipelineConfig(data: Record<string, unknown>): PipelineConfig {
  return {
    framework: data.framework as PipelineConfig["framework"],
    reasoning: data.reasoning as PipelineConfig["reasoning"],
    context: data.context as PipelineConfig["context"],
    harness: data.harness as PipelineConfig["harness"],
    prompt_profile: data.prompt_profile as PipelineConfig["prompt_profile"],
    endpoint_id: data.endpoint_id as PipelineConfig["endpoint_id"],
    model_id: data.model_id as PipelineConfig["model_id"],
    temperature: data.temperature as PipelineConfig["temperature"],
    top_p: data.top_p as PipelineConfig["top_p"],
    frequency_penalty: data.frequency_penalty as PipelineConfig["frequency_penalty"],
    presence_penalty: data.presence_penalty as PipelineConfig["presence_penalty"],
    max_output_tokens: data.max_output_tokens as PipelineConfig["max_output_tokens"],
    thinking_level: data.thinking_level as PipelineConfig["thinking_level"],
    thinking_budget: Number(data.thinking_budget ?? 0),
    thinking_capable: data.thinking_capable as PipelineConfig["thinking_capable"],
    max_steps: data.max_steps as PipelineConfig["max_steps"],
    toolset: data.toolset as PipelineConfig["toolset"],
    mcp_policy: data.mcp_policy as PipelineConfig["mcp_policy"],
    skill_policy: data.skill_policy as PipelineConfig["skill_policy"],
    approval_mode: data.approval_mode as PipelineConfig["approval_mode"],
    sandbox_mode: data.sandbox_mode as PipelineConfig["sandbox_mode"],
    orchestration: data.orchestration as PipelineConfig["orchestration"],
    memory: data.memory as PipelineConfig["memory"],
    history_mode: data.history_mode as PipelineConfig["history_mode"],
    prompt_version: data.prompt_version as PipelineConfig["prompt_version"],
    label: data.label as PipelineConfig["label"],
  };
}
