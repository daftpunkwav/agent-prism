/**
 * @file router
 * @description Dimension routing: pipelines differing in exactly one variable.
 *
 * Responsibilities:
 * - Produce one PipelineConfig per option value of the compared field
 * - Query the injected ProviderDimensionSync for snapshot and options
 *
 * Config syncing is delegated; this class keeps routing and queries only.
 */

import type { BaselineOverrides, DimensionId, PipelineConfig } from "@agentprism/contracts";
import { ARENA_MIN_SELECT } from "@agentprism/contracts";
import { DIMENSION_FIELD, DimensionCatalog, type DimensionOptionTriple } from "@agentprism/dimensions";
import { coerceFieldValue, normalizeOptionToken } from "./field-values.js";
import { resolveBaselineOverrides, buildPipelineBase } from "./baseline.js";
import { listBaselineFields } from "./baseline-fields.js";
import { ProviderDimensionSync } from "./provider-dimension-sync.js";

/** Dimension routing dependencies: catalog + config syncer (both built and injected at the composition root, independently replaceable/mocked). */
export interface DimensionRouterDeps {
  dimensionCatalog: DimensionCatalog;
  providerSync: ProviderDimensionSync;
}

/**
 * Dimension router: generates a list of PipelineConfigs where columns differ by a
 * single variable. Config syncing (provider snapshot cache, catalog option projection)
 * is delegated to the injected ProviderDimensionSync; this class keeps only routing
 * and queries.
 */
export class DimensionRouter {
  readonly dimensionCatalog: DimensionCatalog;
  private readonly sync: ProviderDimensionSync;

  constructor(deps: DimensionRouterDeps) {
    this.dimensionCatalog = deps.dimensionCatalog;
    this.sync = deps.providerSync;
  }

  /** Syncs framework options from the driver registry; the default framework falls back to the first available entry. */
  syncFrameworkOptions(available: Array<{ id: string; name: string }>): void {
    this.sync.syncFrameworkOptions(available);
  }

  /** Syncs prompt/reasoning/context/harness/toolset options from registered plugins. */
  syncCapabilityOptions(options: Partial<Record<string, DimensionOptionTriple[]>>): void {
    this.sync.syncCapabilityOptions(options);
  }

  /** Fully re-syncs model options and decode baseline defaults from the provider config. */
  syncModelOptionsFromProvider(): void {
    this.sync.syncModelOptionsFromProvider();
  }

  /** On-demand sync of provider-derived data (no-op when already synced). */
  ensureModelSynced(): void {
    this.sync.ensureModelSynced();
  }

  /** Call after a provider config change: clears caches and re-syncs. */
  invalidateProviderCache(): void {
    this.sync.invalidateProviderCache();
  }

  modelCompareReady(): boolean {
    return this.dimensionCatalog.modelCompareReady();
  }

  listDimensionOptions(dimension: DimensionId): Array<{ field: string; value: string; label: string }> {
    if (dimension === "model") this.sync.ensureModelSynced();
    return this.dimensionCatalog.dimensionOptions(dimension);
  }

  listBaselineFields(): ReturnType<typeof listBaselineFields> {
    return listBaselineFields({
      dimensionCatalog: this.dimensionCatalog,
      ensureModelSynced: () => this.sync.ensureModelSynced(),
    });
  }

  /** Core of the single-variable principle: each column differs only in the comparison dimension's field. */
  route(dimension: DimensionId, selections: string[] | null | undefined, baseline?: BaselineOverrides | null): PipelineConfig[] {
    if (dimension === "model") this.sync.ensureModelSynced();

    const options = this.dimensionCatalog.dimensionOptions(dimension);
    if (options.length === 0) {
      throw new Error(
        `Dimension "${dimension}" is unknown or has no synced options (capability dimensions start empty until the sync chain runs)`,
      );
    }

    // Numeric dimensions accept custom in-range values, so tokens are normalized
    // ("7.0" → "7") before dedupe to keep alternate spellings on one column.
    const chosen =
      selections !== null && selections !== undefined
        ? [...new Set(selections.map((raw) => this.normalizeSelectionToken(dimension, raw)))]
        : options.map((option) => option.value);
    if (chosen.length < ARENA_MIN_SELECT) {
      throw new Error(
        `Dimension "${dimension}" requires at least ${ARENA_MIN_SELECT} selections, got ${chosen.length}`,
      );
    }

    const baseOverrides = resolveBaselineOverrides(dimension, baseline, {
      provider: this.sync.loadProvider(),
      providerLookup: this.sync.providerLookup,
      dimensionCatalog: this.dimensionCatalog,
    });

    const byValue = new Map(options.map((option) => [option.value, option]));
    const configs: PipelineConfig[] = [];
    for (const value of chosen) {
      const option = byValue.get(value);
      if (option === undefined) {
        const custom = this.customNumericEntry(dimension, value);
        if (custom === undefined) {
          throw new Error(`Dimension "${dimension}" has unsupported option: ${value}`);
        }
        configs.push(
          buildPipelineBase(
            {
              provider: this.sync.loadProvider(),
              providerLookup: this.sync.providerLookup,
              dimensionCatalog: this.dimensionCatalog,
            },
            { ...baseOverrides, [custom.field]: coerceFieldValue(custom.field, custom.token), label: custom.label },
          ),
        );
        continue;
      }
      configs.push(
        buildPipelineBase(
          {
            provider: this.sync.loadProvider(),
            providerLookup: this.sync.providerLookup,
            dimensionCatalog: this.dimensionCatalog,
          },
          { ...baseOverrides, [option.field]: coerceFieldValue(option.field, value), label: option.label },
        ),
      );
    }
    if (dimension !== "framework") {
      for (const config of configs) config.framework = "native";
    }
    if (dimension === "framework") {
      for (const config of configs) {
        config.reasoning = "react";
        config.toolset = "full";
      }
    }
    return configs;
  }

  /** Normalizes a raw selection token so numeric dimensions dedupe alternate spellings of one value. */
  private normalizeSelectionToken(dimension: DimensionId, raw: string): string {
    if (dimension === "max_steps" || dimension === "temperature") {
      return normalizeOptionToken(DIMENSION_FIELD[dimension], raw);
    }
    return raw;
  }

  /**
   * Resolves a custom (not-in-catalog) selection for a numeric dimension.
   * max_steps accepts any in-range integer plus "unlimited"; temperature accepts
   * any in-range number. Returns undefined for non-numeric dimensions or
   * out-of-range values so the caller keeps failing loudly (never silently
   * running a column the user did not ask for).
   */
  private customNumericEntry(dimension: DimensionId, token: string): { field: string; token: string; label: string } | undefined {
    if (dimension !== "max_steps" && dimension !== "temperature") return undefined;
    const field = DIMENSION_FIELD[dimension];
    if (!this.dimensionCatalog.isLegalFieldValue(field, token)) return undefined;
    if (dimension === "max_steps") {
      return { field, token, label: token === "unlimited" ? "unlimited" : `${token} steps` };
    }
    return { field, token, label: token };
  }
}
