/**
 * @file dimension mapping tests
 * @description Locks the dimension field mapping single source.
 *
 * Responsibilities:
 * - Pin every dimension's PipelineConfig field mapping
 */

import { describe, expect, it } from "vitest";
import {
  BUILDER_CUSTOM_BLOCK_PREFIX,
  BuilderCapabilityBlockRefSchema,
  customBlockDimension,
  customFieldDimension,
  customFieldKey,
  DIMENSION_FIELD,
  DIMENSION_IDS,
  dimensionFieldName,
  DimensionIdSchema,
  isBuiltinDimensionId,
} from "@agentprism/contracts";

describe("dimension mapping single-source contract", () => {
  it("DIMENSION_IDS is derived from the zod schema, same source as the enum", () => {
    expect([...DIMENSION_IDS]).toEqual([...DimensionIdSchema.options]);
  });

  it("DIMENSION_FIELD covers every dimension with unique field names", () => {
    expect(Object.keys(DIMENSION_FIELD).sort()).toEqual([...DIMENSION_IDS].sort());
    expect(new Set(Object.values(DIMENSION_FIELD)).size).toBe(DIMENSION_IDS.length);
  });
});

describe("custom dimension field keys", () => {
  it("maps a builtin dimension to its config field and a custom one to the synthetic field", () => {
    expect(dimensionFieldName("context")).toBe(DIMENSION_FIELD.context);
    expect(dimensionFieldName("my_axis")).toBe("custom.my_axis");
  });

  it("maps prototype-named ids to their synthetic field, never to an inherited member", () => {
    // The id grammar admits these names, so the lookup must be own-key: an
    // inherited read would return a function (Object.prototype.constructor) as
    // the field name and silently mis-key the dimension's options.
    for (const id of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(dimensionFieldName(id)).toBe(`custom.${id}`);
    }
  });

  it("round-trips a synthetic field key", () => {
    expect(customFieldKey("my_axis")).toBe("custom.my_axis");
    expect(customFieldDimension("custom.my_axis")).toBe("my_axis");
    // A builtin field name is not a custom key.
    expect(customFieldDimension("context")).toBe("");
  });

  it("recognizes builtin ids only", () => {
    for (const id of DIMENSION_IDS) expect(isBuiltinDimensionId(id)).toBe(true);
    expect(isBuiltinDimensionId("my_axis")).toBe(false);
    expect(isBuiltinDimensionId("Context")).toBe(false);
  });

  it("narrows a Builder block reference: builtin slots and custom blocks", () => {
    expect(BuilderCapabilityBlockRefSchema.safeParse("context").success).toBe(true);
    expect(BuilderCapabilityBlockRefSchema.safeParse(`${BUILDER_CUSTOM_BLOCK_PREFIX}my_axis`).success).toBe(true);
    // Builtin slots stay exactly enumerated; the custom suffix keeps the id grammar.
    expect(BuilderCapabilityBlockRefSchema.safeParse("kontext").success).toBe(false);
    expect(BuilderCapabilityBlockRefSchema.safeParse(`${BUILDER_CUSTOM_BLOCK_PREFIX}My-Axis`).success).toBe(false);
    expect(customBlockDimension("context")).toBe("");
    expect(customBlockDimension(`${BUILDER_CUSTOM_BLOCK_PREFIX}my_axis`)).toBe("my_axis");
  });
});
