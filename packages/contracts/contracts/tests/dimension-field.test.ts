/**
 * @file dimension mapping tests
 * @description Locks the dimension field mapping single source.
 *
 * Responsibilities:
 * - Pin every dimension's PipelineConfig field mapping
 */

import { describe, expect, it } from "vitest";
import { DIMENSION_FIELD, DIMENSION_IDS, DimensionIdSchema } from "@agentprism/contracts";

describe("dimension mapping single-source contract", () => {
  it("DIMENSION_IDS is derived from the zod schema, same source as the enum", () => {
    expect([...DIMENSION_IDS]).toEqual([...DimensionIdSchema.options]);
  });

  it("DIMENSION_FIELD covers every dimension with unique field names", () => {
    expect(Object.keys(DIMENSION_FIELD).sort()).toEqual([...DIMENSION_IDS].sort());
    expect(new Set(Object.values(DIMENSION_FIELD)).size).toBe(DIMENSION_IDS.length);
  });
});
