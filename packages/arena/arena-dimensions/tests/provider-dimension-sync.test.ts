/**
 * @file provider dimension sync tests
 * @description Keeps model option labels unique.
 *
 * Responsibilities:
 * - Preserve the pipeline aggregate-key contract on synced options
 */

import { describe, expect, it } from "vitest";
import type { LlmEndpoint, ProviderConfig, ProviderLookup } from "@agentprism/contracts";
import { ProviderDimensionSync, endpointThinkingAxes } from "@agentprism/arena-dimensions";
import { DimensionCatalog } from "@agentprism/dimensions";

function makeEndpoint(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    label: "",
    model: "gpt-x",
    base_url: `https://${id}.example.com/v1`,
    api_format: "openai_chat",
    api_key: "",
    use_full_url: false,
    thinking_capable: false,
    thinking_level: "off",
    context_window: 128000,
    max_input_tokens: 120000,
    max_output_tokens: 4096,
    ...overrides,
  };
}

function makeSync(endpoints: Record<string, unknown>[], defaultEndpointId = ""): ProviderDimensionSync {
  const provider = {
    endpoints,
    default_endpoint_id: defaultEndpointId,
    temperature: 0.7,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    max_output_tokens: 2048,
  } as unknown as ProviderConfig;
  const lookup: ProviderLookup = {
    load: () => provider,
    syncEndpointCatalog: () => {},
    lookupEndpoint: () => undefined,
    listEndpoints: () => provider.endpoints,
  };
  return new ProviderDimensionSync({ dimensionCatalog: new DimensionCatalog(), providerLookup: lookup });
}

describe("model dimension option label uniqueness (pipeline aggregate-key contract)", () => {
  it("two endpoints with the same model and empty labels project unique labels", () => {
    const sync = makeSync([makeEndpoint("ep-1"), makeEndpoint("ep-2")]);
    sync.syncModelOptionsFromProvider();
    const labels = sync.catalog.dimensionOptions("model").map((option) => option.label);
    expect(labels).toHaveLength(2);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("user-duplicated labels are also disambiguated, and the default marker does not break uniqueness", () => {
    const sync = makeSync(
      [makeEndpoint("ep-1", { label: "primary" }), makeEndpoint("ep-2", { label: "primary" })],
      "ep-1",
    );
    sync.syncModelOptionsFromProvider();
    const labels = sync.catalog.dimensionOptions("model").map((option) => option.label);
    expect(new Set(labels).size).toBe(labels.length);
    // Default endpoint keeps the "(current)" marker semantics
    expect(labels.some((label) => label.includes("current"))).toBe(true);
  });

  it("disabled endpoints disappear from the model dimension options", () => {
    const sync = makeSync([
      makeEndpoint("ep-1"),
      makeEndpoint("ep-2", { enabled: false }),
    ]);
    sync.syncModelOptionsFromProvider();
    const values = sync.catalog.dimensionOptions("model").map((option) => option.value);
    expect(values).toContain("ep-1");
    expect(values).not.toContain("ep-2");
  });

  it("a disabled stored default moves the default marker and baseline default to the first enabled endpoint", () => {
    // The shared default-endpoint rule (contracts): labelling or defaulting the
    // model dimension to a disabled endpoint would pin every unpinned arena run
    // to an endpoint model construction refuses.
    const sync = makeSync([
      makeEndpoint("ep-1", { label: "primary", enabled: false }),
      makeEndpoint("ep-2", { label: "standby" }),
    ], "ep-1");
    sync.syncModelOptionsFromProvider();
    const options = sync.catalog.dimensionOptions("model");
    expect(options.find((option) => option.value === "ep-2")?.label).toContain("current");
    expect(options.find((option) => option.value === "ep-1")).toBeUndefined();
    expect(sync.catalog.defaultBaseValue("endpoint_id")).toBe("ep-2");
    expect(sync.catalog.defaultBaseValue("model_id")).toBe("gpt-x");
  });

  it("same-name empty-label endpoints outside the default are disambiguated (locks the true-duplicate case)", () => {
    // Old impl (no disambiguation) projected two identical "gpt-x" here; events/reports silently merged by label —
    // the default item's "(current)" suffix alone cannot lock this regression; use non-default duplicates.
    const sync = makeSync([
      makeEndpoint("ep-0", { model: "other-model" }),
      makeEndpoint("ep-1"),
      makeEndpoint("ep-2"),
    ], "ep-0");
    sync.syncModelOptionsFromProvider();
    const labels = sync.catalog.dimensionOptions("model").map((option) => option.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.filter((label) => label.startsWith("gpt-x"))).toHaveLength(2);
    expect(labels.some((label) => label === "gpt-x (ep-2)")).toBe(true);
  });

  it("hand-written label equal to another's disambiguation product does not collide (single-if residual window)", () => {
    // ep-3's hand-written label "gpt-x (ep-2)" enters the set first; ep-2's disambiguation product matches —
    // old impl added once then Set silently deduped, two column labels collided and pipeline merged them.
    const sync = makeSync([
      makeEndpoint("ep-3", { label: "gpt-x (ep-2)" }),
      makeEndpoint("ep-1"),
      makeEndpoint("ep-2"),
      makeEndpoint("ep-0", { model: "other-model" }),
    ], "ep-0");
    sync.syncModelOptionsFromProvider();
    const options = sync.catalog.dimensionOptions("model");
    const labels = options.map((option) => option.label);
    expect(new Set(labels).size).toBe(labels.length);
    const ep2 = options.find((option) => option.value === "ep-2");
    expect(ep2?.label).toBe("gpt-x (ep-2) (ep-2)");
  });
});

describe("mutually exclusive thinking axes follow the default endpoint's mode", () => {
  it("level mode: the thinking axis mirrors the endpoint level set and the budget axis empties", () => {
    const sync = makeSync([
      makeEndpoint("ep-1", {
        thinking_capable: true,
        thinking_level: "max",
        thinking_levels: ["max", "mid"],
        thinking_mode: "levels",
        thinking_budget_pairs: [{ level: "super", budget_tokens: 500_000, max_tokens: 1_000_000 }],
      }),
    ], "ep-1");
    sync.syncModelOptionsFromProvider();
    const catalog = sync.catalog;
    expect(catalog.dimensionOptions("thinking_level").map((o) => o.value)).toEqual(["off", "max", "mid"]);
    expect(catalog.defaultBaseValue("thinking_level")).toBe("max");
    expect(catalog.dimensionOptions("thinking_budget")).toEqual([]);
    expect(catalog.defaultBaseValue("thinking_budget")).toBe(0);
    expect(catalog.defaultBaseValue("thinking_mode")).toBe("levels");
  });

  it("standard level sets apply when the endpoint has no custom list", () => {
    const sync = makeSync([
      makeEndpoint("ep-1", { thinking_capable: true, thinking_level: "high" }),
    ], "ep-1");
    sync.syncModelOptionsFromProvider();
    expect(sync.catalog.dimensionOptions("thinking_level").map((o) => o.value)).toEqual(["off", "low", "medium", "high"]);
  });

  it("budget mode: the budget axis carries the pair table and the level axis empties", () => {
    const sync = makeSync([
      makeEndpoint("ep-1", {
        api_format: "anthropic_messages",
        thinking_capable: true,
        thinking_level: "super",
        thinking_mode: "budget",
        thinking_budget_pairs: [
          { level: "low", budget_tokens: 1000, max_tokens: 1200 },
          { level: "super", budget_tokens: 500_000, max_tokens: 1_000_000 },
        ],
      }),
    ], "ep-1");
    sync.syncModelOptionsFromProvider();
    const catalog = sync.catalog;
    expect(catalog.dimensionOptions("thinking_level")).toEqual([]);
    expect(catalog.defaultBaseValue("thinking_level")).toBe("off");
    const budget = catalog.dimensionOptions("thinking_budget");
    expect(budget.map((o) => o.value)).toEqual(["0", "low", "super"]);
    expect(budget[2]?.label).toContain("500000");
    expect(catalog.defaultBaseValue("thinking_budget")).toBe("super");
    expect(catalog.defaultBaseValue("thinking_mode")).toBe("budget");
  });

  it("budget mode with no pairs degrades to level-mode axes (never both empty)", () => {
    const sync = makeSync([
      makeEndpoint("ep-1", {
        api_format: "anthropic_messages",
        thinking_capable: true,
        thinking_level: "high",
        thinking_mode: "budget",
        thinking_budget_pairs: [],
      }),
    ], "ep-1");
    sync.syncModelOptionsFromProvider();
    expect(sync.catalog.dimensionOptions("thinking_level").map((o) => o.value)).toEqual(["off", "low", "medium", "high"]);
    expect(sync.catalog.dimensionOptions("thinking_budget")).toEqual([]);
    expect(sync.catalog.defaultBaseValue("thinking_mode")).toBe("levels");
  });
});

describe("thinking_mode baseline option convergence", () => {
  it("a non-budget-capable endpoint serves levels only (no dead budget tab)", () => {
    const sync = makeSync([
      makeEndpoint("ep-1", { thinking_capable: true, thinking_level: "high" }),
    ], "ep-1");
    sync.syncModelOptionsFromProvider();
    const modes = sync.catalog.baselineOnlyOptions()["thinking_mode"]?.map(([value]) => value);
    expect(modes).toEqual(["levels"]);
    expect(sync.catalog.isLegalFieldValue("thinking_mode", "budget")).toBe(false);
    expect(sync.catalog.isLegalFieldValue("thinking_mode", "levels")).toBe(true);
  });

  it("a budget-capable endpoint serves both modes and keeps budget pairs legal", () => {
    const sync = makeSync([
      makeEndpoint("ep-1", {
        api_format: "anthropic_messages",
        thinking_capable: true,
        thinking_level: "super",
        thinking_mode: "budget",
        thinking_budget_pairs: [{ level: "super", budget_tokens: 500_000, max_tokens: 1_000_000 }],
      }),
    ], "ep-1");
    sync.syncModelOptionsFromProvider();
    const modes = sync.catalog.baselineOnlyOptions()["thinking_mode"]?.map(([value]) => value);
    expect(modes).toEqual(["levels", "budget"]);
    expect(sync.catalog.isLegalFieldValue("thinking_mode", "budget")).toBe(true);
    expect(sync.catalog.isLegalFieldValue("thinking_budget", "super")).toBe(true);
  });
});

describe("endpointThinkingAxes (per-endpoint meta projection)", () => {
  it("budget mode: level axis empties, budget axis carries the pair table with the off token", () => {
    const axes = endpointThinkingAxes(makeEndpoint("ep-1", {
      api_format: "anthropic_messages",
      thinking_capable: true,
      thinking_level: "super",
      thinking_mode: "budget",
      thinking_budget_pairs: [
        { level: "low", budget_tokens: 1000, max_tokens: 1200 },
        { level: "super", budget_tokens: 500_000, max_tokens: 1_000_000 },
      ],
    }) as unknown as LlmEndpoint);
    expect(axes.level_options).toEqual([]);
    expect(axes.level_default).toBe("off");
    expect(axes.budget_options.map((o) => o.value)).toEqual(["0", "low", "super"]);
    expect(axes.budget_default).toBe("super");
    expect(axes.mode_options.map((o) => o.value)).toEqual(["levels", "budget"]);
    expect(axes.mode_default).toBe("budget");
  });

  it("level mode with a custom level set: the level axis mirrors it and budget stays empty", () => {
    const axes = endpointThinkingAxes(makeEndpoint("ep-1", {
      thinking_capable: true,
      thinking_level: "max",
      thinking_levels: ["max", "mid"],
      thinking_mode: "levels",
    }) as unknown as LlmEndpoint);
    expect(axes.level_options.map((o) => o.value)).toEqual(["off", "max", "mid"]);
    expect(axes.level_default).toBe("max");
    expect(axes.budget_options).toEqual([]);
    expect(axes.budget_default).toBe("0");
    expect(axes.mode_options.map((o) => o.value)).toEqual(["levels"]);
    expect(axes.mode_default).toBe("levels");
  });

  it("a thinking-incapable endpoint serves an empty level axis and levels-only mode", () => {
    const axes = endpointThinkingAxes(makeEndpoint("ep-1") as unknown as LlmEndpoint);
    expect(axes.level_options.map((o) => o.value)).toEqual(["off"]);
    expect(axes.level_default).toBe("off");
    expect(axes.budget_options).toEqual([]);
    expect(axes.mode_options.map((o) => o.value)).toEqual(["levels"]);
  });

  it("budget pairs on a non-anthropic format stay inert (no dead budget mode)", () => {
    const axes = endpointThinkingAxes(makeEndpoint("ep-1", {
      thinking_capable: true,
      thinking_level: "high",
      thinking_mode: "levels",
      thinking_budget_pairs: [{ level: "super", budget_tokens: 500_000, max_tokens: 1_000_000 }],
    }) as unknown as LlmEndpoint);
    expect(axes.mode_options.map((o) => o.value)).toEqual(["levels"]);
    expect(axes.budget_options).toEqual([]);
    expect(axes.level_options.map((o) => o.value)).toEqual(["off", "low", "medium", "high"]);
  });
});
