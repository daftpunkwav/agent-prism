/**
 * @file dimension router tests
 * @description Locks routing delegation and single-variable guardrails.
 *
 * Responsibilities:
 * - Pin sync/query delegation onto the injected collaborators
 * - Pin empty-option and under-selection rejection
 */

import { describe, expect, it, vi } from "vitest";
import { DimensionCatalog } from "@agentprism/dimensions";
import { DimensionRouter } from "../src/router.js";
import type { ProviderDimensionSync } from "../src/provider-dimension-sync.js";

function stubEndpoint() {
  return {
    id: "ep-1",
    model: "test-model",
    thinking_capable: false,
  };
}

function stubSync() {
  const endpoint = stubEndpoint();
  return {
    ensureModelSynced: vi.fn(),
    invalidateProviderCache: vi.fn(),
    syncFrameworkOptions: vi.fn(),
    syncCapabilityOptions: vi.fn(),
    syncModelOptionsFromProvider: vi.fn(),
    loadProvider: vi.fn().mockReturnValue({
      endpoints: [endpoint],
      default_endpoint_id: "ep-1",
      temperature: 0,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      max_output_tokens: 2048,
    }),
    providerLookup: {
      lookupEndpoint: () => endpoint,
      listEndpoints: () => [endpoint],
    },
  } as unknown as ProviderDimensionSync;
}

function routerWith(
  catalog: Pick<DimensionCatalog, "dimensionOptions" | "modelCompareReady"> & Partial<DimensionCatalog>,
) {
  const fullCatalog = {
    defaultBaseValues: {},
    isKnownField: () => true,
    isLegalFieldValue: () => true,
    ...catalog,
  };
  return new DimensionRouter({
    dimensionCatalog: fullCatalog as DimensionCatalog,
    providerSync: stubSync(),
  });
}

describe("DimensionRouter delegation", () => {
  it("forwards sync calls to the provider syncer", () => {
    const sync = stubSync();
    const router = new DimensionRouter({
      dimensionCatalog: { dimensionOptions: () => [], modelCompareReady: () => true } as unknown as DimensionCatalog,
      providerSync: sync,
    });
    router.syncFrameworkOptions([{ id: "native", name: "Native" }]);
    router.invalidateProviderCache();
    expect(sync.syncFrameworkOptions).toHaveBeenCalledWith([{ id: "native", name: "Native" }]);
    expect(sync.invalidateProviderCache).toHaveBeenCalledOnce();
  });

  it("syncs models on demand for the model dimension only", () => {
    const sync = stubSync();
    const router = new DimensionRouter({
      dimensionCatalog: {
        dimensionOptions: () => [{ field: "model", value: "m", label: "M" }],
        modelCompareReady: () => true,
      } as unknown as DimensionCatalog,
      providerSync: sync,
    });
    router.listDimensionOptions("framework");
    expect(sync.ensureModelSynced).not.toHaveBeenCalled();
    router.listDimensionOptions("model");
    expect(sync.ensureModelSynced).toHaveBeenCalledOnce();
  });
});

describe("DimensionRouter.route guardrails", () => {
  it("rejects dimensions without synced options", () => {
    const router = routerWith({ dimensionOptions: () => [], modelCompareReady: () => true });
    expect(() => router.route("prompt", ["a", "b"])).toThrow(/no synced options/);
  });

  it("allows a single selection (minimum is 1)", () => {
    const router = routerWith({
      dimensionOptions: () => [
        { field: "framework", value: "native", label: "Native" },
        { field: "framework", value: "langchain", label: "LangChain" },
      ],
      modelCompareReady: () => true,
    });
    expect(() => router.route("framework", ["native"])).not.toThrow();
    expect(router.route("framework", ["native"])).toHaveLength(1);
  });

  it("rejects an explicit empty selection", () => {
    const router = routerWith({
      dimensionOptions: () => [
        { field: "framework", value: "native", label: "Native" },
        { field: "framework", value: "langchain", label: "LangChain" },
      ],
      modelCompareReady: () => true,
    });
    expect(() => router.route("framework", [])).toThrow(/at least 1/);
  });

});

describe("DimensionRouter.route custom numeric values", () => {
  /** Real catalog + stub provider sync: exercises the custom-value channel end to end. */
  function realRouter() {
    return new DimensionRouter({
      dimensionCatalog: new DimensionCatalog(),
      providerSync: stubSync(),
    });
  }

  it("accepts a custom in-range max_steps selection and labels the column", () => {
    const router = realRouter();
    const configs = router.route("max_steps", ["7", "10"]);
    expect(configs).toHaveLength(2);
    expect(configs.map((c) => c.max_steps).sort((a, b) => a - b)).toEqual([7, 10]);
    expect(configs.map((c) => c.label).sort()).toEqual(["10 steps", "7 steps"]);
  });

  it("dedupes alternate spellings of the same custom value", () => {
    const router = realRouter();
    const configs = router.route("max_steps", ["7", "7.0"]);
    expect(configs).toHaveLength(1);
    expect(configs[0]?.max_steps).toBe(7);
  });

  it("routes an unlimited steps column via the unlimited token", () => {
    const router = realRouter();
    const configs = router.route("max_steps", ["unlimited", "5"]);
    expect(configs.map((c) => c.max_steps).sort((a, b) => a - b)).toEqual([-1, 5]);
    expect(configs.some((c) => c.label === "unlimited")).toBe(true);
  });

  it("rejects out-of-range custom max_steps values loudly", () => {
    const router = realRouter();
    expect(() => router.route("max_steps", ["0", "5"])).toThrow(/unsupported option/);
    expect(() => router.route("max_steps", ["100001", "5"])).toThrow(/unsupported option/);
  });

  it("accepts custom in-range temperature and rejects out-of-range values", () => {
    const router = realRouter();
    const configs = router.route("temperature", ["0.85", "0.7"]);
    expect(configs.map((c) => c.temperature).sort()).toEqual([0.7, 0.85]);
    expect(() => router.route("temperature", ["3", "0.7"])).toThrow(/unsupported option/);
  });

  it("still rejects unknown values on non-numeric dimensions", () => {
    const router = realRouter();
    expect(() => router.route("framework", ["nope", "native"])).toThrow(/unsupported option/);
  });

  it("routes memory columns differing only in the memory policy", () => {
    const router = realRouter();
    const configs = router.route("memory", ["none", "full"]);
    expect(configs).toHaveLength(2);
    expect(configs.map((c) => c.memory).sort()).toEqual(["full", "none"]);
    expect(configs.map((c) => c.framework)).toEqual(["native", "native"]);
  });
});
