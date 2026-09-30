/**
 * @file arena baseline tests
 * @description Locks baseline endpoint/model resolution fail-loud behavior.
 *
 * Responsibilities:
 * - Pin model_id/endpoint_id merge, agreement, and conflict handling
 */

import { describe, expect, it } from "vitest";
import type { ProviderConfig, ProviderLookup } from "@agentprism/contracts";
import { buildPipelineBase, resolveBaselineOverrides } from "@agentprism/arena-dimensions";
import { ProviderDimensionSync } from "@agentprism/arena-dimensions";
import { DimensionCatalog } from "@agentprism/dimensions";

function makeEndpoint(id: string, model: string): Record<string, unknown> {
  return {
    id,
    label: "",
    model,
    base_url: `https://${id}.example.com/v1`,
    api_format: "openai_chat",
    api_key: "",
    use_full_url: false,
    thinking_capable: false,
    thinking_level: "off",
    context_window: 128000,
    max_input_tokens: 120000,
    max_output_tokens: 4096,
  };
}

function makeDeps() {
  const provider = {
    endpoints: [makeEndpoint("ep-1", "gpt-x"), makeEndpoint("ep-2", "other-model")],
    default_endpoint_id: "ep-1",
    temperature: 0.7,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    max_output_tokens: 2048,
  } as unknown as ProviderConfig;
  const lookup: ProviderLookup = {
    load: () => provider,
    syncEndpointCatalog: () => {},
    lookupEndpoint: (id: string) => provider.endpoints.find((endpoint) => endpoint.id === id),
    listEndpoints: () => provider.endpoints,
  };
  // Sync first: endpoint_id legality is checked against synced model options.
  const sync = new ProviderDimensionSync({ dimensionCatalog: new DimensionCatalog(), providerLookup: lookup });
  sync.syncModelOptionsFromProvider();
  return { provider, lookup, catalog: sync.catalog };
}

describe("resolveBaselineOverrides endpoint/model resolution", () => {
  it("merges a known model_id into its endpoint_id", () => {
    const { provider, lookup, catalog } = makeDeps();
    const resolved = resolveBaselineOverrides("prompt", { model_id: "other-model" }, { provider, providerLookup: lookup, dimensionCatalog: catalog });
    expect(resolved.endpoint_id).toBe("ep-2");
  });

  it("throws on an unknown model_id instead of silently ignoring it", () => {
    const { provider, lookup, catalog } = makeDeps();
    expect(() => resolveBaselineOverrides("prompt", { model_id: "nope" }, { provider, providerLookup: lookup, dimensionCatalog: catalog })).toThrow(
      'Baseline model_id "nope" has no matching endpoint',
    );
  });

  it("accepts agreeing model_id + endpoint_id pairs", () => {
    const { provider, lookup, catalog } = makeDeps();
    const resolved = resolveBaselineOverrides(
      "prompt",
      { model_id: "gpt-x", endpoint_id: "ep-1" },
      { provider, providerLookup: lookup, dimensionCatalog: catalog },
    );
    expect(resolved.endpoint_id).toBe("ep-1");
  });

  it("throws when model_id names a different endpoint's model (no silent drop)", () => {
    const { provider, lookup, catalog } = makeDeps();
    expect(() =>
      resolveBaselineOverrides(
        "prompt",
        { model_id: "other-model", endpoint_id: "ep-1" },
        { provider, providerLookup: lookup, dimensionCatalog: catalog },
      ),
    ).toThrow('Baseline model_id "other-model" conflicts with endpoint_id "ep-1"');
  });

  it("buildPipelineBase throws on an unknown endpoint_id override (no endpoints[0] fallback)", () => {
    const { provider, lookup, catalog } = makeDeps();
    expect(() =>
      buildPipelineBase({ provider, providerLookup: lookup, dimensionCatalog: catalog }, { endpoint_id: "ghost" }),
    ).toThrow('Baseline endpoint_id "ghost" has no matching endpoint');
  });

  it("applies a requested endpoint's own model and capability to the column config", () => {
    const { provider, lookup, catalog } = makeDeps();
    // Threads pin endpoint_id, so a resumed turn must run the pinned endpoint's
    // model: dropping this branch would silently run the default endpoint instead.
    const config = buildPipelineBase(
      { provider, providerLookup: lookup, dimensionCatalog: catalog },
      { endpoint_id: "ep-2" },
    );
    expect(config.endpoint_id).toBe("ep-2");
    expect(config.model_id).toBe("other-model");
    expect(config.thinking_capable).toBe(false);
  });

  it("accepts approval_mode as a baseline-only control field", () => {
    const { provider, lookup, catalog } = makeDeps();
    const resolved = resolveBaselineOverrides("prompt", { approval_mode: "unless_trusted" }, { provider, providerLookup: lookup, dimensionCatalog: catalog });
    expect(resolved.approval_mode).toBe("unless_trusted");
  });

  it("keeps approval_mode through the merge into the column config (never dropped)", () => {
    const { provider, lookup, catalog } = makeDeps();
    const config = buildPipelineBase({ provider, providerLookup: lookup, dimensionCatalog: catalog }, { approval_mode: "unless_trusted" });
    expect(config.approval_mode).toBe("unless_trusted");
  });

  it("defaults approval_mode to auto when the baseline omits it", () => {
    const { provider, lookup, catalog } = makeDeps();
    const config = buildPipelineBase({ provider, providerLookup: lookup, dimensionCatalog: catalog }, {});
    expect(config.approval_mode).toBe("auto");
  });

  it("accepts off-option numeric temperature/top_p and coerces them", () => {
    const { provider, lookup, catalog } = makeDeps();
    const resolved = resolveBaselineOverrides("prompt", { temperature: "0.35", top_p: "0.85" }, { provider, providerLookup: lookup, dimensionCatalog: catalog });
    expect(resolved.temperature).toBe(0.35);
    expect(resolved.top_p).toBe(0.85);
    const config = buildPipelineBase({ provider, providerLookup: lookup, dimensionCatalog: catalog }, resolved);
    expect(config.temperature).toBe(0.35);
    expect(config.top_p).toBe(0.85);
  });

  it("accepts off-option in-range max_steps/penalties and coerces them", () => {
    const { provider, lookup, catalog } = makeDeps();
    const resolved = resolveBaselineOverrides("prompt", { max_steps: "7", frequency_penalty: "-1.5", presence_penalty: "0.3" }, { provider, providerLookup: lookup, dimensionCatalog: catalog });
    expect(resolved.max_steps).toBe(7);
    expect(resolved.frequency_penalty).toBe(-1.5);
    expect(resolved.presence_penalty).toBe(0.3);
  });

  it("accepts the unlimited token for max_steps and coerces it to the -1 sentinel", () => {
    const { provider, lookup, catalog } = makeDeps();
    const resolved = resolveBaselineOverrides("prompt", { max_steps: "unlimited" }, { provider, providerLookup: lookup, dimensionCatalog: catalog });
    expect(resolved.max_steps).toBe(-1);
    const config = buildPipelineBase({ provider, providerLookup: lookup, dimensionCatalog: catalog }, resolved);
    expect(config.max_steps).toBe(-1);
  });

  it("rejects out-of-range max_steps loudly", () => {
    const { provider, lookup, catalog } = makeDeps();
    expect(() => resolveBaselineOverrides("prompt", { max_steps: "100001" }, { provider, providerLookup: lookup, dimensionCatalog: catalog })).toThrow(
      'Baseline field "max_steps" has unsupported value',
    );
    expect(() => resolveBaselineOverrides("prompt", { max_steps: "0" }, { provider, providerLookup: lookup, dimensionCatalog: catalog })).toThrow(
      'Baseline field "max_steps" has unsupported value',
    );
  });

  it("rejects out-of-range numeric temperature/top_p loudly", () => {
    const { provider, lookup, catalog } = makeDeps();
    expect(() => resolveBaselineOverrides("prompt", { temperature: "2.5" }, { provider, providerLookup: lookup, dimensionCatalog: catalog })).toThrow(
      'Baseline field "temperature" has unsupported value',
    );
    expect(() => resolveBaselineOverrides("prompt", { top_p: "abc" }, { provider, providerLookup: lookup, dimensionCatalog: catalog })).toThrow(
      'Baseline field "top_p" has unsupported value',
    );
  });

  it("passes a label override through as the column identity pin", () => {
    const { provider, lookup, catalog } = makeDeps();
    const resolved = resolveBaselineOverrides("prompt", { label: "t-abc123" }, { provider, providerLookup: lookup, dimensionCatalog: catalog });
    expect(resolved.label).toBe("t-abc123");
    const config = buildPipelineBase({ provider, providerLookup: lookup, dimensionCatalog: catalog }, { label: "t-abc123" });
    expect(config.label).toBe("t-abc123");
  });

  it("resolves to no overrides for null/undefined baselines", () => {
    const { provider, lookup, catalog } = makeDeps();
    expect(resolveBaselineOverrides("prompt", null, { provider, providerLookup: lookup, dimensionCatalog: catalog })).toEqual({});
    expect(resolveBaselineOverrides("prompt", undefined, { provider, providerLookup: lookup, dimensionCatalog: catalog })).toEqual({});
  });

  it("skips the compared dimension's own locked field", () => {
    const { provider, lookup, catalog } = makeDeps();
    // For the prompt dimension the locked field is prompt_profile: it must not
    // leak into the overrides (it is the variable under comparison).
    const resolved = resolveBaselineOverrides(
      "prompt",
      { prompt_profile: "few_shot", temperature: "0.7" },
      { provider, providerLookup: lookup, dimensionCatalog: catalog },
    );
    expect("prompt_profile" in resolved).toBe(false);
    expect(resolved.temperature).toBe(0.7);
  });

  it("rejects unknown baseline fields loudly", () => {
    const { provider, lookup, catalog } = makeDeps();
    expect(() =>
      resolveBaselineOverrides("prompt", { not_a_field: "x" } as never, { provider, providerLookup: lookup, dimensionCatalog: catalog }),
    ).toThrow("Baseline does not support field: not_a_field");
  });

  it("falls back to the first configured endpoint only when nothing was requested", () => {
    const { provider, lookup, catalog } = makeDeps();
    const config = buildPipelineBase({ provider, providerLookup: lookup, dimensionCatalog: catalog }, {});
    expect(config.endpoint_id).toBe("ep-1"); // default_endpoint_id wins via lookup
  });


describe("mutually exclusive thinking modes", () => {
  /** Anthropic endpoint configured for budget mode with two pair rows. */
  function makeBudgetDeps() {
    const provider = {
      endpoints: [
        {
          id: "ep-budget",
          label: "",
          model: "thinker-x",
          base_url: "https://budget.example.com/v1",
          api_format: "anthropic_messages",
          api_key: "",
          use_full_url: false,
          thinking_capable: true,
          thinking_level: "super",
          thinking_levels: [],
          thinking_mode: "budget",
          thinking_budget_pairs: [
            { level: "low", budget_tokens: 1000, max_tokens: 1200 },
            { level: "super", budget_tokens: 500_000, max_tokens: 1_000_000 },
          ],
          context_window: 128000,
          max_input_tokens: 120000,
          max_output_tokens: 4096,
        },
      ],
      default_endpoint_id: "ep-budget",
      temperature: 0.7,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      max_output_tokens: 2048,
    } as unknown as ProviderConfig;
    const lookup: ProviderLookup = {
      load: () => provider,
      syncEndpointCatalog: () => {},
      lookupEndpoint: (id: string) => provider.endpoints.find((endpoint) => endpoint.id === id),
      listEndpoints: () => provider.endpoints,
    };
    const sync = new ProviderDimensionSync({ dimensionCatalog: new DimensionCatalog(), providerLookup: lookup });
    sync.syncModelOptionsFromProvider();
    return { provider, lookup, catalog: sync.catalog };
  }

  it("resolves a budget pair level to its numeric pair and pins the level off", () => {
    const { provider, lookup, catalog } = makeBudgetDeps();
    const config = buildPipelineBase(
      { provider, providerLookup: lookup, dimensionCatalog: catalog },
      { thinking_budget: "super" },
    );
    expect(config.thinking_mode).toBe("budget");
    expect(config.thinking_level).toBe("off");
    expect(config.thinking_budget).toBe(500_000);
    expect(config.thinking_max_tokens).toBe(1_000_000);
  });

  it("rejects a level override in budget mode (fail loud, never silently dropped)", () => {
    const { provider, lookup, catalog } = makeBudgetDeps();
    expect(() =>
      buildPipelineBase(
        { provider, providerLookup: lookup, dimensionCatalog: catalog },
        { thinking_budget: "super", thinking_level: "high" },
      ),
    ).toThrow("not applicable in budget mode");
  });

  it("rejects an unknown budget level loudly", () => {
    const { provider, lookup, catalog } = makeBudgetDeps();
    expect(() =>
      buildPipelineBase(
        { provider, providerLookup: lookup, dimensionCatalog: catalog },
        { thinking_budget: "ghost" },
      ),
    ).toThrow('Baseline thinking_budget "ghost" matches no budget pair');
  });

  it("rejects a budget override on a level-mode endpoint", () => {
    const { provider, lookup, catalog } = makeDeps();
    expect(() =>
      buildPipelineBase(
        { provider, providerLookup: lookup, dimensionCatalog: catalog },
        { thinking_budget: "2048" },
      ),
    ).toThrow("not applicable in level mode");
  });

  it("rejects a budget level the catalog never offered (levels-mode sync leaves the axis empty)", () => {
    const { provider, lookup, catalog } = makeBudgetDeps();
    expect(() =>
      resolveBaselineOverrides("prompt", { thinking_budget: "2048" }, { provider, providerLookup: lookup, dimensionCatalog: catalog }),
    ).toThrow('Baseline thinking_budget "2048" matches no budget pair on endpoint "ep-budget"');
  });

  it("keeps level mode working when the baseline pins the mode explicitly", () => {
    const { provider, lookup, catalog } = makeBudgetDeps();
    const config = buildPipelineBase(
      { provider, providerLookup: lookup, dimensionCatalog: catalog },
      { thinking_mode: "levels", thinking_level: "low" },
    );
    expect(config.thinking_mode).toBe("levels");
    expect(config.thinking_level).toBe("low");
    expect(config.thinking_budget).toBe(0);
    expect(config.thinking_max_tokens).toBe(0);
  });

  it("records the applied mode when a budget-mode endpoint carries no pair table", () => {
    // anthropic + capable + mode=budget, but the table is empty: the run
    // degrades to level semantics and the column config must say so instead
    // of labelling itself "budget" with nothing behind it.
    const provider = {
      endpoints: [
        {
          id: "ep-empty",
          label: "",
          model: "empty-pairs",
          base_url: "https://empty.example.com/v1",
          api_format: "anthropic_messages",
          api_key: "",
          use_full_url: false,
          thinking_capable: true,
          thinking_level: "high",
          thinking_levels: [],
          thinking_mode: "budget",
          thinking_budget_pairs: [],
          context_window: 128000,
          max_input_tokens: 120000,
          max_output_tokens: 4096,
        },
      ],
      default_endpoint_id: "ep-empty",
      temperature: 0.7,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      max_output_tokens: 2048,
    } as unknown as ProviderConfig;
    const lookup: ProviderLookup = {
      load: () => provider,
      syncEndpointCatalog: () => {},
      lookupEndpoint: (id: string) => provider.endpoints.find((endpoint) => endpoint.id === id),
      listEndpoints: () => provider.endpoints,
    };
    const sync = new ProviderDimensionSync({ dimensionCatalog: new DimensionCatalog(), providerLookup: lookup });
    sync.syncModelOptionsFromProvider();
    const config = buildPipelineBase(
      { provider, providerLookup: lookup, dimensionCatalog: sync.catalog },
      { thinking_budget: "0" },
    );
    expect(config.thinking_mode).toBe("levels");
    expect(config.thinking_level).toBe("high");
    expect(config.thinking_budget).toBe(0);
  });

  it("follows the endpoint mode when the baseline omits thinking_mode", () => {
    const { provider, lookup, catalog } = makeBudgetDeps();
    const config = buildPipelineBase(
      { provider, providerLookup: lookup, dimensionCatalog: catalog },
      {},
    );
    expect(config.thinking_mode).toBe("budget");
    // The endpoint default pair level ("super") seeds the catalog default.
    expect(config.thinking_budget).toBe(500_000);
    expect(config.thinking_max_tokens).toBe(1_000_000);
  });

  it("rejects an explicitly pinned budget mode the synced catalog does not offer", () => {
    // The default sync here serves an openai endpoint with thinking disabled:
    // budget pairs never apply on it, so the pin is illegal at the validation
    // layer already (endpoint-scoped, not the catalog-wide option table).
    const { provider, lookup, catalog } = makeDeps();
    expect(() =>
      resolveBaselineOverrides("prompt", { thinking_mode: "budget" }, { provider, providerLookup: lookup, dimensionCatalog: catalog }),
    ).toThrow('Baseline thinking_mode "budget" is not applicable on endpoint');
  });

  it("rejects a pinned budget mode on a thinking-incapable endpoint at assembly", () => {
    // Direct assembly bypass (old client / internal caller): the mode cannot
    // apply, and the column must fail loud instead of running level semantics
    // while carrying a "budget" label.
    const { provider, lookup, catalog } = makeDeps();
    expect(() =>
      buildPipelineBase(
        { provider, providerLookup: lookup, dimensionCatalog: catalog },
        { thinking_mode: "budget" },
      ),
    ).toThrow('thinking_mode "budget" is not applicable on endpoint "ep-1"');
  });

  it("rejects a pinned budget mode on an anthropic endpoint without pair rows", () => {
    const provider = {
      endpoints: [
        {
          id: "ep-anthropic",
          label: "",
          model: "anthropic-no-pairs",
          base_url: "https://anthropic.example.com/v1",
          api_format: "anthropic_messages",
          api_key: "",
          use_full_url: false,
          thinking_capable: true,
          thinking_level: "high",
          thinking_levels: [],
          thinking_mode: "levels",
          thinking_budget_pairs: [],
          context_window: 128000,
          max_input_tokens: 120000,
          max_output_tokens: 4096,
        },
      ],
      default_endpoint_id: "ep-anthropic",
      temperature: 0.7,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      max_output_tokens: 2048,
    } as unknown as ProviderConfig;
    const lookup: ProviderLookup = {
      load: () => provider,
      syncEndpointCatalog: () => {},
      lookupEndpoint: (id: string) => provider.endpoints.find((endpoint) => endpoint.id === id),
      listEndpoints: () => provider.endpoints,
    };
    const sync = new ProviderDimensionSync({ dimensionCatalog: new DimensionCatalog(), providerLookup: lookup });
    sync.syncModelOptionsFromProvider();
    expect(() =>
      buildPipelineBase(
        { provider, providerLookup: lookup, dimensionCatalog: sync.catalog },
        { thinking_mode: "budget" },
      ),
    ).toThrow("no budget pairs configured");
  });
});

  it("fails loud when no endpoints are configured at all", () => {
    const provider = { endpoints: [], temperature: 0.7 } as unknown as ProviderConfig;
    const lookup: ProviderLookup = {
      load: () => provider,
      syncEndpointCatalog: () => {},
      lookupEndpoint: () => undefined,
      listEndpoints: () => [],
    };
    expect(() =>
      buildPipelineBase({ provider, providerLookup: lookup, dimensionCatalog: new DimensionCatalog() }, {}),
    ).toThrow("No endpoints configured");
  });
});
