/**
 * @file provider dimension sync tests
 * @description Keeps model option labels unique.
 *
 * Responsibilities:
 * - Preserve the pipeline aggregate-key contract on synced options
 */

import { describe, expect, it } from "vitest";
import type { ProviderConfig, ProviderLookup } from "@agentprism/contracts";
import { ProviderDimensionSync } from "@agentprism/arena-dimensions";
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
