/**
 * @file baseline fields tests
 * @description Locks baseline defaults and the panel field list on a real catalog.
 */

import { describe, expect, it, vi } from "vitest";
import { DimensionCatalog } from "@agentprism/dimensions";
import { baselineDefaultToken, listBaselineFields } from "../src/baseline-fields.js";

describe("baselineDefaultToken", () => {
  it("falls back to 1 for top_p and 96000 for max_output_tokens", () => {
    const catalog = new DimensionCatalog();
    expect(baselineDefaultToken(catalog, "top_p")).toBe("1");
    expect(baselineDefaultToken(catalog, "max_output_tokens")).toBe("96000");
  });

  it("flags the numeric fields as numeric inputs with ranges", () => {
    const catalog = new DimensionCatalog();
    const ensureModelSynced = vi.fn();
    const fields = listBaselineFields({ dimensionCatalog: catalog, ensureModelSynced });
    const byName = new Map(fields.map((f) => [f.field, f]));
    expect(byName.get("temperature")).toMatchObject({ input: "number", min: 0, max: 2, allow_unlimited: false });
    expect(byName.get("top_p")).toMatchObject({ input: "number", min: 0, max: 1, allow_unlimited: false });
    expect(byName.get("frequency_penalty")).toMatchObject({ input: "number", min: -2, max: 2, allow_unlimited: false });
    expect(byName.get("presence_penalty")).toMatchObject({ input: "number", min: -2, max: 2, allow_unlimited: false });
    expect(byName.get("max_output_tokens")).toMatchObject({ input: "number", min: 64, max: 384_000, allow_unlimited: false });
    expect(byName.get("max_steps")).toMatchObject({ input: "number", min: 1, max: 100_000, allow_unlimited: true });
  });
});

describe("listBaselineFields", () => {
  it("syncs models, then serves labeled fields with options", () => {
    const catalog = new DimensionCatalog();
    const ensureModelSynced = vi.fn();
    const fields = listBaselineFields({ dimensionCatalog: catalog, ensureModelSynced });
    expect(ensureModelSynced).toHaveBeenCalledOnce();
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      expect(field.field).not.toBe("");
      expect(field.label).not.toBe("");
      expect(Array.isArray(field.options)).toBe(true);
    }
  });
});
