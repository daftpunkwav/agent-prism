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
import { dimensionFieldName, customFieldDimension, resolveDefaultEndpoint, servableThinkingLevels } from "@agentprism/contracts";
import {
  effectiveThinkingLevel,
  MAX_OUTPUT_TOKENS_OPTIONS,
  PENALTY_OPTIONS,
  TEMPERATURE_OPTIONS,
  TOP_P_OPTIONS,
} from "@agentprism/contracts";
import type { DimensionCatalog } from "@agentprism/dimensions";
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
  dimension: string,
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

  const lockedField = dimensionFieldName(dimension);
  assertThinkingPinsLegal(raw, deps);
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    // Custom-dimension pins arrive as one nested record; each entry becomes a
    // synthetic `custom.<id>` field so it is validated exactly like a builtin
    // baseline field (unknown id or illegal value fails loud, never silently).
    if (key === "custom") {
      for (const [customId, customValue] of Object.entries(value as Record<string, unknown>)) {
        const customField = dimensionFieldName(customId);
        if (customField === lockedField) continue;
        if (!deps.dimensionCatalog.isKnownField(customField)) {
          throw new Error(`Baseline does not support custom dimension: ${customId}`);
        }
        const customToken = normalizeOptionToken(customField, customValue);
        if (!deps.dimensionCatalog.isLegalFieldValue(customField, customToken)) {
          throw new Error(`Baseline custom dimension "${customId}" has unsupported value: ${String(customValue)}`);
        }
        resolved[customField] = customToken;
      }
      continue;
    }
    if (key === lockedField) continue;
    if (key === "thinking_level" || key === "thinking_budget" || key === "thinking_mode") {
      // Legality was checked endpoint-scoped by assertThinkingPinsLegal (the
      // catalog options are a default-endpoint snapshot and may not match this
      // baseline's endpoint); pass the token through to buildPipelineBase.
      resolved[key] = coerceFieldValue(key, String(value));
      continue;
    }
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
 * Endpoint-scoped legality for the three thinking pins. The catalog option
 * tables are a default-endpoint snapshot, so a baseline pinned to another
 * endpoint must validate against that endpoint's own level set / budget pair
 * table — the same semantics applyThinkingFields then enforces per column.
 * The endpoint resolves from the baseline's endpoint_id (else the catalog
 * default); an unresolvable endpoint is left to buildPipelineBase's loud error.
 */
function assertThinkingPinsLegal(raw: Record<string, unknown>, deps: BaselineResolverDeps): void {
  const modePin = raw.thinking_mode;
  const levelPin = raw.thinking_level;
  const budgetPin = raw.thinking_budget;
  if (modePin === undefined && levelPin === undefined && budgetPin === undefined) return;
  const requested =
    typeof raw.endpoint_id === "string" && raw.endpoint_id !== ""
      ? raw.endpoint_id
      : String(deps.dimensionCatalog.defaultBaseValue("endpoint_id") ?? "");
  const endpoint = requested !== "" ? deps.providerLookup.lookupEndpoint(requested, deps.provider) : undefined;
  if (endpoint === undefined) return;
  const pairs = endpoint.thinking_budget_pairs ?? [];
  const budgetApplicable =
    endpoint.thinking_capable && endpoint.api_format === "anthropic_messages" && pairs.length > 0;
  if (modePin !== undefined && !(modePin === "levels" || (modePin === "budget" && budgetApplicable))) {
    throw new Error(
      `Baseline thinking_mode "${String(modePin)}" is not applicable on endpoint "${endpoint.id}" ` +
        `(${endpoint.api_format}${endpoint.thinking_capable ? ", no budget pairs configured" : ", thinking not capable"})`,
    );
  }
  // The mode that would actually apply: the pin when servable, else the endpoint's
  // own configuration (an unservable budget-mode config degrades to levels below).
  const effectiveMode =
    modePin === "levels" || modePin === "budget"
      ? modePin
      : endpoint.thinking_mode === "budget" && budgetApplicable
        ? "budget"
        : "levels";
  if (effectiveMode === "budget") {
    if (levelPin !== undefined && levelPin !== "off") {
      throw new Error(
        `Baseline thinking_level "${String(levelPin)}" is not applicable in budget mode: unset it or switch the thinking mode`,
      );
    }
    if (
      budgetPin !== undefined &&
      budgetPin !== "" &&
      budgetPin !== "0" &&
      !pairs.some((pair) => pair.level === String(budgetPin))
    ) {
      throw new Error(`Baseline thinking_budget "${String(budgetPin)}" matches no budget pair on endpoint "${endpoint.id}"`);
    }
    return;
  }
  const allowed = servableThinkingLevels(endpoint);
  if (levelPin !== undefined && levelPin !== "off" && !allowed.includes(String(levelPin))) {
    throw new Error(
      `Baseline thinking_level "${String(levelPin)}" is not served by endpoint "${endpoint.id}" (serves: ${["off", ...allowed].join(", ")})`,
    );
  }
  if (budgetPin !== undefined && budgetPin !== "" && budgetPin !== "0") {
    throw new Error(
      `Baseline thinking_budget "${String(budgetPin)}" is not applicable in level mode: unset it or switch the thinking mode`,
    );
  }
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
    // Unpinned column with no synced baseline default: fall back to the shared
    // default-endpoint rule (contracts) so a disabled endpoint never receives
    // traffic here either (model construction would refuse it anyway).
    endpoint = resolveDefaultEndpoint(provider);
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
    // Raw catalog seed; applyThinkingFields clamps it once the effective mode
    // is known (clamping here would pre-lose the seed for the other mode).
    thinking_level: String(base.thinking_level ?? "off"),
    // Overwritten below once the effective thinking mode is known; the budget
    // seed rides the catalog default (a pair level name in budget mode, 0 otherwise).
    thinking_budget: base.thinking_budget ?? 0,
    thinking_max_tokens: 0,
    temperature: Number(base.temperature ?? snapToOptions(provider.temperature, TEMPERATURE_OPTIONS)),
    top_p: Number(base.top_p ?? snapToOptions(provider.top_p, TOP_P_OPTIONS)),
    frequency_penalty: Number(base.frequency_penalty ?? snapToOptions(provider.frequency_penalty, PENALTY_OPTIONS)),
    presence_penalty: Number(base.presence_penalty ?? snapToOptions(provider.presence_penalty, PENALTY_OPTIONS)),
    max_output_tokens: Math.trunc(
      Number(base.max_output_tokens ?? snapIntToOptions(provider.max_output_tokens, MAX_OUTPUT_TOKENS_OPTIONS)),
    ),
    label: "",
    // Custom-dimension values collect here from the `custom.<id>` override keys.
    custom: {} as Record<string, string>,
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
    if (key === "thinking_level" || key === "thinking_budget" || key === "thinking_mode") {
      // All three resolve together after the loop: the mode routes which of the
      // two intensity fields applies, against the endpoint this column actually
      // runs on (the catalog options were synced from the default endpoint and
      // may not match it).
      continue;
    }
    // Synthetic custom fields collect into the nested record PipelineConfig carries.
    const customId = customFieldDimension(key);
    if (customId !== "") {
      (data.custom as Record<string, string>)[customId] = String(value);
      continue;
    }
    data[key] = coerceFieldValue(key, value);
  }

  applyThinkingFields(data, endpoint, overrides);
  return toPipelineConfig(data);
}

/**
 * Applies the mutually exclusive thinking fields against the column's endpoint.
 * The mode comes from the baseline override when given, else the endpoint's own
 * configuration; the two intensity fields can never both apply:
 * - level mode: the requested level resolves through effectiveThinkingLevel
 *   (illegal levels fail closed to off); any budget override is rejected loud —
 *   the catalog would normally have refused it already, but the endpoint may
 *   have switched modes after the options were synced.
 * - budget mode (anthropic endpoints with budget pairs): the budget token is a
 *   pair level name resolved to its numeric pair; a non-off level override is
 *   rejected loud for the same reason.
 */
function applyThinkingFields(
  data: Record<string, unknown>,
  endpoint: LlmEndpoint,
  overrides: Record<string, unknown>,
): void {
  const baselineMode = overrides.thinking_mode === "budget" || overrides.thinking_mode === "levels"
    ? overrides.thinking_mode
    : undefined;
  const mode = baselineMode ?? endpoint.thinking_mode;
  data.thinking_mode = mode;
  const requestedLevel =
    overrides.thinking_level !== undefined ? String(overrides.thinking_level) : String(data.thinking_level ?? "off");
  const requestedBudget =
    overrides.thinking_budget !== undefined ? String(overrides.thinking_budget) : String(data.thinking_budget ?? 0);

  const budgetApplicable =
    endpoint.thinking_capable && endpoint.api_format === "anthropic_messages" && (endpoint.thinking_budget_pairs ?? []).length > 0;
  // An explicitly pinned mode is caller intent: asking for budget semantics on
  // an endpoint that cannot serve them must fail loud, never silently run as
  // level mode while the column config claims "budget". (The endpoint's own
  // mismatched default still degrades below — that is config auto-healing, not
  // a caller request.)
  if (overrides.thinking_mode === "budget" && !budgetApplicable) {
    throw new Error(
      `Baseline thinking_mode "budget" is not applicable on endpoint "${endpoint.id}" (${endpoint.api_format}${endpoint.thinking_capable ? ", no budget pairs configured" : ", thinking not capable"}); use level mapping or switch the endpoint`,
    );
  }
  if (mode === "budget" && budgetApplicable) {
    if (overrides.thinking_level !== undefined && requestedLevel !== "off") {
      throw new Error(
        `Baseline thinking_level "${requestedLevel}" is not applicable in budget mode: unset it or switch the thinking mode`,
      );
    }
    const pair = (endpoint.thinking_budget_pairs ?? []).find((candidate) => candidate.level === requestedBudget);
    if (requestedBudget === "" || requestedBudget === "0") {
      data.thinking_level = "off";
      data.thinking_budget = 0;
      data.thinking_max_tokens = 0;
      return;
    }
    if (pair === undefined) {
      throw new Error(`Baseline thinking_budget "${requestedBudget}" matches no budget pair on endpoint "${endpoint.id}"`);
    }
    if (pair.budget_tokens < 1024) {
      // Fail here, not at model construction: thinking.ts drops overrides below
      // the 1024 protocol floor, which would silently run the column without
      // thinking while its config claims a budget.
      throw new Error(
        `Baseline thinking_budget "${requestedBudget}" has budget_tokens ${pair.budget_tokens}, below the protocol floor of 1024, on endpoint "${endpoint.id}"`,
      );
    }
    data.thinking_level = "off";
    data.thinking_budget = pair.budget_tokens;
    data.thinking_max_tokens = pair.max_tokens;
    return;
  }

  if (overrides.thinking_budget !== undefined && requestedBudget !== "" && requestedBudget !== "0") {
    throw new Error(
      `Baseline thinking_budget "${requestedBudget}" is not applicable in level mode: unset it or switch the thinking mode`,
    );
  }
  // Record the mode that actually applied: a budget token on an endpoint
  // without pairs (or on another format) degrades to level semantics here.
  data.thinking_mode = "levels";
  // Validation must match the applied semantics: a degenerate budget endpoint
  // (no pair table) validates against its level set, not its empty table.
  data.thinking_level = effectiveThinkingLevel({ ...endpoint, thinking_mode: "levels" }, requestedLevel);
  data.thinking_budget = 0;
  data.thinking_max_tokens = 0;
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
    thinking_max_tokens: Number(data.thinking_max_tokens ?? 0),
    thinking_mode: data.thinking_mode === "budget" ? "budget" : "levels",
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
    custom: (data.custom ?? {}) as PipelineConfig["custom"],
  };
}
