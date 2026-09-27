/**
 * @file custom dimension registry tests
 * @description Locks the custom-dimension registry: authoring guards, resolution
 * order, and the run-time failure for an id no package provides.
 */

import { describe, expect, it } from "vitest";
import type { CustomDimension } from "@agentprism/contracts";
import {
  customDimension,
  customDimensionDefault,
  listCustomDimensions,
  registerCustomDimensions,
  resolveCustomDimensions,
} from "../../src/dimensions/custom-dimensions.js";

const base: CustomDimension = {
  id: "registry_probe",
  label: "Registry probe",
  options: [
    { value: "a", label: "A" },
    { value: "b", label: "B" },
  ],
};

/** Id that also exists on Object.prototype; the grammar allows it, and registration is idempotent per identity. */
const prototypeNamed: CustomDimension = { ...base, id: "constructor", label: "Prototype-named axis" };

describe("registration guards", () => {
  it("rejects ids outside lower_snake_case", () => {
    expect(() => registerCustomDimensions([{ ...base, id: "Probe-Axis" }])).toThrow(/lower_snake_case/);
    expect(() => registerCustomDimensions([{ ...base, id: "" }])).toThrow(/lower_snake_case/);
  });

  it("rejects an id that collides with a builtin dimension", () => {
    expect(() => registerCustomDimensions([{ ...base, id: "context" }])).toThrow(/builtin dimension/);
  });

  it("rejects an id that collides with a builtin context strategy", () => {
    // Both surface in one effectiveness report under their id: a dimension named
    // after a strategy would merge its rows with that strategy's, so the run's
    // kept/dropped volume would describe neither of the two.
    expect(() => registerCustomDimensions([{ ...base, id: "sliding" }])).toThrow(/builtin context strategy/);
    expect(() => registerCustomDimensions([{ ...base, id: "summary" }])).toThrow(/builtin context strategy/);
  });

  it("rejects option values that no config record could persist", () => {
    // The wire records (PipelineConfig.custom, BaselineOverrides.custom,
    // BuilderComposition.custom) bound every value; a longer one is selectable in
    // the Arena yet unusable in the Builder and unpinnable, so it must fail at
    // authoring time instead of surfacing as a stray 422.
    const long = { value: "v".repeat(201), label: "Long" };
    expect(() => registerCustomDimensions([{ ...base, id: "probe_long_value", options: [long] }])).toThrow(
      /exceeds 200 chars/,
    );
    const atBound = { value: "v".repeat(200), label: "At bound" };
    expect(() => registerCustomDimensions([{ ...base, id: "probe_value_bound", options: [atBound] }])).not.toThrow();
  });

  it("rejects descriptors that cannot render", () => {
    expect(() => registerCustomDimensions([{ ...base, id: "probe_label", label: " " }])).toThrow(/label/);
    expect(() => registerCustomDimensions([{ ...base, id: "probe_options", options: [] }])).toThrow(/at least one option/);
    expect(() =>
      registerCustomDimensions([
        { ...base, id: "probe_dup", options: [{ value: "a", label: "A" }, { value: "a", label: "A2" }] },
      ]),
    ).toThrow(/duplicate option/);
    expect(() => registerCustomDimensions([{ ...base, id: "probe_default", default: "zzz" }])).toThrow(/not one of its options/);
  });

  it("rejects a second package claiming a registered id", () => {
    registerCustomDimensions([base]);
    expect(() => registerCustomDimensions([{ ...base, label: "Impostor" }])).toThrow(/already registered/);
    expect(customDimension(base.id)?.label).toBe("Registry probe");
  });

  it("keeps re-registering the same descriptor idempotent", () => {
    registerCustomDimensions([base]);
    const registered = customDimension(base.id);
    if (registered === undefined) throw new Error("fixture dimension missing");
    registerCustomDimensions([registered]);
    expect(listCustomDimensions().filter((dimension) => dimension.id === base.id)).toHaveLength(1);
  });
});

describe("defaults and resolution", () => {
  it("defaults to the first option unless a default is declared", () => {
    expect(customDimensionDefault(base)).toBe("a");
    expect(customDimensionDefault({ ...base, default: "b" })).toBe("b");
  });

  it("resolves configured values in registration order", () => {
    registerCustomDimensions([base, { ...base, id: "registry_probe_two", label: "Probe two" }]);
    const active = resolveCustomDimensions({ registry_probe_two: "a", registry_probe: "b" });
    expect(active.map((entry) => entry.dimension.id)).toEqual(["registry_probe", "registry_probe_two"]);
    expect(active.map((entry) => entry.value)).toEqual(["b", "a"]);
  });

  it("returns nothing for an empty or absent record", () => {
    expect(resolveCustomDimensions(undefined)).toEqual([]);
    expect(resolveCustomDimensions({})).toEqual([]);
  });

  it("fails loudly for an id no package provides", () => {
    expect(() => resolveCustomDimensions({ ghost_dimension: "a" })).toThrow(/Unknown custom dimension/);
  });

  it("fails loudly for a value the dimension no longer defines", () => {
    // A session stored before its package changed its option list must not run
    // under a stale value: the assembly validates values, not just ids.
    registerCustomDimensions([base]);
    expect(() => resolveCustomDimensions({ registry_probe: "c" })).toThrow(/unsupported value "c"/);
    expect(resolveCustomDimensions({ registry_probe: "b" })).toHaveLength(1);
  });

  it("reads configured values off own keys only", () => {
    // The id grammar allows names that live on Object.prototype; reading such an
    // unset id off the record would resolve to the inherited member and hand the
    // hooks a function where the dimension's own value belongs.
    // Registered here, so the case owns its fixtures instead of borrowing the
    // registrations of the cases above (which would make it order-dependent).
    registerCustomDimensions([base, prototypeNamed]);
    expect(resolveCustomDimensions({ registry_probe: "b" }).map((entry) => entry.dimension.id)).toEqual([
      "registry_probe",
    ]);
    expect(resolveCustomDimensions({ constructor: "a" }).map((entry) => entry.dimension.id)).toEqual(["constructor"]);
  });
});
