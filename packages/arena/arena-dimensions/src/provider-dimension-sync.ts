/**
 * @file provider-dimension-sync
 * @description Projects external provider state onto the dimension catalog.
 *
 * Responsibilities:
 * - Keep an in-process snapshot of the provider config
 * - Project driver registry and endpoint config onto catalog options
 * - Project decode baseline defaults
 *
 * External state to catalog projection only; routing lives in DimensionRouter.
 */

import type { EndpointThinkingAxes, LlmEndpoint, ProviderConfig, ProviderLookup } from "@agentprism/contracts";
import { customFieldKey, MAX_OUTPUT_TOKENS_OPTIONS, PENALTY_OPTIONS, TEMPERATURE_OPTIONS, TOP_P_OPTIONS } from "@agentprism/contracts";
import { customDimension, customDimensionDefault } from "@agentprism/harness";
import { currentEndpointLabel, DimensionCatalog, type DimensionOptionTriple } from "@agentprism/dimensions";
import { snapIntToOptions, snapToOptions } from "./field-values.js";

/**
 * Projects one endpoint's thinking configuration onto the three thinking baseline
 * axes (level / budget / mode). Single source for both the catalog sync (default
 * endpoint) and the meta payload's per-endpoint record, so the baseline panel and
 * the run-request validation can never disagree about what an endpoint serves.
 *
 * Mode options follow endpoint capability: budget pairs only exist on
 * anthropic_messages endpoints, so any other endpoint serves ["levels"] only —
 * offering budget there would be a dead end (the run-side fails loud on it).
 * When the endpoint is an active budget-mode one, the level axis empties and the
 * budget axis carries the pair table (plus the "0" follow-level token).
 */
export function endpointThinkingAxes(endpoint: LlmEndpoint): EndpointThinkingAxes {
  const budgetPairsApplicable =
    endpoint.thinking_capable &&
    endpoint.api_format === "anthropic_messages" &&
    (endpoint.thinking_budget_pairs ?? []).length > 0;
  const modeOptions: EndpointThinkingAxes["mode_options"] = [{ value: "levels", label: "Level mapping" }];
  if (budgetPairsApplicable) modeOptions.push({ value: "budget", label: "Budget pairs" });
  if (endpoint.thinking_capable && endpoint.thinking_mode === "budget" && budgetPairsApplicable) {
    const defaultPair = (endpoint.thinking_budget_pairs ?? []).find((pair) => pair.level === endpoint.thinking_level);
    return {
      level_options: [],
      level_default: "off",
      budget_options: [
        { value: "0", label: "Off" },
        ...(endpoint.thinking_budget_pairs ?? []).map((pair) => ({
          value: pair.level,
          label: `${pair.level} · ${pair.budget_tokens}/${pair.max_tokens > 0 ? pair.max_tokens : "auto"} tok`,
        })),
      ],
      budget_default: defaultPair === undefined ? "0" : defaultPair.level,
      mode_options: modeOptions,
      mode_default: "budget",
    };
  }
  const customLevels = endpoint.thinking_levels ?? [];
  const levels = endpoint.thinking_capable
    ? (customLevels.length > 0 ? customLevels : ["low", "medium", "high"])
    : [];
  return {
    level_options: [
      { value: "off", label: "Off" },
      ...levels.map((name) => ({ value: name, label: name })),
    ],
    level_default: endpoint.thinking_capable ? endpoint.thinking_level : "off",
    budget_options: [],
    budget_default: "0",
    mode_options: modeOptions,
    mode_default: "levels",
  };
}

/** Config sync dependencies: catalog + provider lookup port (wired at the composition root; the instance is created and held by DimensionRouter). */
export interface ProviderDimensionSyncDeps {
  dimensionCatalog: DimensionCatalog;
  providerLookup: ProviderLookup;
}

/**
 * Config syncer: maintains an in-process snapshot of the provider config and projects
 * the driver registry / endpoint config onto DimensionCatalog options and decode
 * baseline defaults. Deliberately separate from dimension routing (route): this class
 * only owns the "external state → catalog projection" concern.
 */
export class ProviderDimensionSync {
  readonly providerLookup: ProviderLookup;
  private readonly dimensionCatalog: DimensionCatalog;
  private cachedProvider: ProviderConfig | null = null;

  constructor(deps: ProviderDimensionSyncDeps) {
    this.dimensionCatalog = deps.dimensionCatalog;
    this.providerLookup = deps.providerLookup;
  }

  /** Catalog reference (read-only use on the query side). */
  get catalog(): DimensionCatalog {
    return this.dimensionCatalog;
  }

  /** Provider config snapshot: avoids re-reading disk on every routing/baseline-resolution request. */
  loadProvider(): ProviderConfig {
    if (this.cachedProvider === null) {
      this.cachedProvider = this.providerLookup.load();
    }
    return this.cachedProvider;
  }

  /** Call after a provider config change: clears the snapshot and re-syncs options. */
  invalidateProviderCache(): void {
    this.cachedProvider = null;
    this.syncModelOptionsFromProvider();
  }

  /** Syncs framework options from the driver registry; the default framework falls back to the first available entry. */
  syncFrameworkOptions(available: Array<{ id: string; name: string }>): void {
    if (available.length === 0) return;
    this.dimensionCatalog.setDimensionOptions(
      "framework",
      available.map((item): DimensionOptionTriple => ({ field: "framework", value: item.id, label: item.name })),
    );
    const ids = new Set(available.map((item) => item.id));
    const currentFramework = this.dimensionCatalog.defaultBaseValue("framework");
    if (typeof currentFramework !== "string" || !ids.has(currentFramework)) {
      this.dimensionCatalog.setDefaultBase("framework", available[0]?.id ?? "native");
    }
  }

  /**
   * Overwrites capability dimension options from the registered projection.
   * Empty projections are skipped (not blanked): a partial sync must never wipe a
   * dimension. Custom dimensions additionally seed their effective default
   * (declared, else the first option), so the baseline panel and pin resolution
   * see it exactly like a builtin default.
   */
  syncCapabilityOptions(options: Partial<Record<string, DimensionOptionTriple[]>>): void {
    for (const [dimension, triples] of Object.entries(options)) {
      if (triples === undefined || triples.length === 0) continue;
      this.dimensionCatalog.setDimensionOptions(dimension, triples);
      const custom = customDimension(dimension);
      if (custom !== undefined) {
        this.dimensionCatalog.setDefaultBase(customFieldKey(dimension), customDimensionDefault(custom));
      }
    }
  }

  /** Syncs model options and decode baseline defaults from the provider config. */
  syncModelOptionsFromProvider(): void {
    const provider = this.loadProvider();
    this.providerLookup.syncEndpointCatalog(provider);
    // Disabled endpoints are a settings-side off switch: they disappear from the
    // model dimension options while their ids keep resolving (a run pinning one
    // fails loud at model construction, not silently here).
    const endpoints = provider.endpoints.filter((endpoint) => endpoint.enabled !== false);
    const defaultId = provider.default_endpoint_id || endpoints[0]?.id || "";
    // Column display labels are the pipeline aggregation key (the events contract requires
    // producers to keep them unique): a non-default endpoint's label defaults to its model
    // name, so same-named models/labels would produce duplicate labels and silently merge
    // events and reports by label — disambiguate duplicates with the endpoint id.
    const seenLabels = new Set<string>();
    const options: DimensionOptionTriple[] = endpoints.map((endpoint) => {
      const base = endpoint.label.trim() !== "" ? endpoint.label : endpoint.model;
      let label = endpoint.id === defaultId ? currentEndpointLabel(base) : base;
      // Loop re-check instead of a single if: a hand-written label may exactly equal another
      // endpoint's disambiguated product ("a (ep-2)") and could still collide after one
      // append (each round appends " (id)", strictly growing; ids are unique, so it converges)
      while (seenLabels.has(label)) {
        label = `${label} (${endpoint.id})`;
      }
      seenLabels.add(label);
      return {
        field: "endpoint_id",
        value: endpoint.id,
        label,
      };
    });
    this.dimensionCatalog.setDimensionOptions("model", options);
    this.dimensionCatalog.setDefaultBase("endpoint_id", defaultId);
    const defaultEndpoint = this.providerLookup.lookupEndpoint(defaultId, provider) ?? endpoints[0];
    if (defaultEndpoint !== undefined) {
      this.dimensionCatalog.setDefaultBase("model_id", defaultEndpoint.model);
      // The two thinking axes are mutually exclusive and follow the default
      // endpoint's projected axes (shared with the meta payload's per-endpoint
      // record): level mode exposes the endpoint's level set on the thinking
      // axis; an active budget-mode endpoint exposes the pair table on the
      // budget axis instead. Mode tokens follow capability, so a levels-mode
      // endpoint that has a servable pair table still offers the budget switch.
      const axes = endpointThinkingAxes(defaultEndpoint);
      this.dimensionCatalog.setDimensionOptions(
        "thinking_level",
        axes.level_options.map((option): DimensionOptionTriple => ({ field: "thinking_level", ...option })),
      );
      this.dimensionCatalog.setDefaultBase("thinking_level", axes.level_default);
      this.dimensionCatalog.setDimensionOptions(
        "thinking_budget",
        axes.budget_options.map((option): DimensionOptionTriple => ({ field: "thinking_budget", ...option })),
      );
      this.dimensionCatalog.setDefaultBase("thinking_budget", axes.budget_default === "0" ? 0 : axes.budget_default);
      this.dimensionCatalog.setDefaultBase("thinking_mode", axes.mode_default);
      this.dimensionCatalog.setBaselineFieldOptions(
        "thinking_mode",
        axes.mode_options.map((option): DimensionOptionTriple => ({ field: "thinking_mode", ...option })),
      );
    }
    this.dimensionCatalog.setDefaultBase("temperature", snapToOptions(provider.temperature, TEMPERATURE_OPTIONS));
    this.dimensionCatalog.setDefaultBase("top_p", snapToOptions(provider.top_p, TOP_P_OPTIONS));
    this.dimensionCatalog.setDefaultBase("frequency_penalty", snapToOptions(provider.frequency_penalty, PENALTY_OPTIONS));
    this.dimensionCatalog.setDefaultBase("presence_penalty", snapToOptions(provider.presence_penalty, PENALTY_OPTIONS));
    this.dimensionCatalog.setDefaultBase(
      "max_output_tokens",
      snapIntToOptions(provider.max_output_tokens, MAX_OUTPUT_TOKENS_OPTIONS),
    );
  }

  /** Syncs on demand when the model dimension has no options/default yet (lazy path). */
  ensureModelSynced(): void {
    const modelOptions = this.dimensionCatalog.dimensionOptions("model");
    if (modelOptions.length === 0 || this.dimensionCatalog.defaultBaseValue("endpoint_id") === undefined) {
      this.syncModelOptionsFromProvider();
    }
  }
}
