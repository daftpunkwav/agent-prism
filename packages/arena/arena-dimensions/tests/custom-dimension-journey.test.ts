/**
 * @file custom dimension journey tests
 * @description End-to-end journey for a registered custom dimension: the arena
 * route expands it into one column per value, the values reach the run config,
 * the meta/baseline projections expose it, and unknown axes fail loudly.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { PipelineConfig, ProviderConfig } from "@agentprism/contracts";
import { registerCustomDimensions } from "@agentprism/harness";
import { DimensionCatalog } from "@agentprism/dimensions";
import { DimensionRouter } from "../src/router.js";
import { ProviderDimensionSync } from "../src/provider-dimension-sync.js";
import { buildCapabilityOptionProjection } from "../src/capability-options.js";
import { listBaselineFields } from "../src/baseline-fields.js";

const DIMENSION_ID = "journey_probe";

registerCustomDimensions([
  {
    id: DIMENSION_ID,
    label: "Journey probe",
    subtitle: "Probe axis",
    options: [
      { value: "low", label: "Low" },
      { value: "high", label: "High" },
    ],
    default: "low",
  },
]);

const provider: ProviderConfig = {
  endpoints: [
    {
      id: "ep1",
      label: "Endpoint one",
      model: "model-one",
      api_format: "openai_chat",
      thinking_capable: false,
      enabled: true,
    },
  ],
} as unknown as ProviderConfig;

/** Provider lookup stub: the journey exercises projection + routing, not disk IO. */
const lookup = {
  load: () => provider,
  lookupEndpoint: (id: string, config: ProviderConfig) =>
    config.endpoints.find((endpoint) => endpoint.id === id),
  listEndpoints: () => provider.endpoints,
  syncEndpointCatalog: () => undefined,
};

function makeRouter(): DimensionRouter {
  const catalog = new DimensionCatalog();
  // Real sync instance: the journey must cover the startup projection the
  // composition root performs, including custom-dimension defaults.
  const providerSync = new ProviderDimensionSync({
    dimensionCatalog: catalog,
    providerLookup: lookup as unknown as ConstructorParameters<typeof ProviderDimensionSync>[0]["providerLookup"],
  });
  const router = new DimensionRouter({ dimensionCatalog: catalog, providerSync });
  router.syncCapabilityOptions(buildCapabilityOptionProjection());
  router.syncFrameworkOptions([{ id: "native", name: "Native" }]);
  return router;
}

const route = (router: DimensionRouter, dimension: string, selections: string[]): PipelineConfig[] =>
  router.route(dimension, selections, null);

describe("custom dimension journey", () => {
  let router: DimensionRouter;
  beforeEach(() => {
    router = makeRouter();
  });

  it("offers the axis with its options and declared default", () => {
    const options = router.listDimensionOptions(DIMENSION_ID);
    expect(options.map((option) => option.value)).toEqual(["low", "high"]);
    const fields = listBaselineFields({
      dimensionCatalog: router.dimensionCatalog,
      ensureModelSynced: () => undefined,
    });
    const row = fields.find((field) => field.field === `custom.${DIMENSION_ID}`);
    expect(row?.dimension).toBe(DIMENSION_ID);
    expect(row?.label).toBe("Journey probe");
    expect(row?.default).toBe("low");
    expect(row?.options.map((option) => option.value)).toEqual(["low", "high"]);
  });

  it("expands one column per selected value with the value in the run config", () => {
    const configs = route(router, DIMENSION_ID, ["low", "high"]);
    expect(configs).toHaveLength(2);
    expect(configs.map((config) => config.custom[DIMENSION_ID])).toEqual(["low", "high"]);
    // Single-variable principle: everything else stays identical between columns.
    expect(configs[0]?.framework).toBe(configs[1]?.framework);
    expect(configs[0]?.label).not.toBe(configs[1]?.label);
  });

  it("pins a custom value through the baseline while comparing another axis", () => {
    const configs = router.route("framework", ["native"], {
      custom: { [DIMENSION_ID]: "high" },
    });
    expect(configs[0]?.custom[DIMENSION_ID]).toBe("high");
  });

  it("does not let a baseline pin lock the axis under comparison", () => {
    // Single-variable principle: when the custom axis itself is the variable, the
    // baseline's own pin for it must not survive into the columns (they would all
    // collapse onto the pinned value).
    const configs = router.route(DIMENSION_ID, ["low", "high"], {
      custom: { [DIMENSION_ID]: "low" },
    });
    expect(configs.map((config) => config.custom[DIMENSION_ID])).toEqual(["low", "high"]);
  });

  it("rejects a custom value that is not one of the dimension's options", () => {
    expect(() => router.route("framework", ["native"], { custom: { [DIMENSION_ID]: "medium" } })).toThrow(
      /unsupported value/,
    );
  });

  it("rejects a custom pin for a dimension no package provides", () => {
    expect(() => router.route("framework", ["native"], { custom: { ghost: "x" } })).toThrow(
      /does not support custom dimension/,
    );
  });

  it("fails loudly when the compared axis is unregistered", () => {
    expect(() => route(router, "ghost_dimension", ["x"])).toThrow(/unknown or has no synced options/);
  });

  it("keeps the builtin axes untouched (context still lists its six strategies)", () => {
    const values = router.listDimensionOptions("context").map((option) => option.value);
    expect(values).toEqual(["sliding", "summary", "vector", "hybrid", "tool_tail", "token_budget"]);
  });
});
