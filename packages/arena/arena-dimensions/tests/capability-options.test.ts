/**
 * @file capability options tests
 * @description Locks capability projection: live-registry gating, static
 * toolsets, and one comparison axis per registered custom dimension.
 */

import { describe, expect, it } from "vitest";
import { TOOL_NAMES_BY_TOOLSET } from "@agentprism/contracts";
import { registerCustomDimensions } from "@agentprism/harness";
import { TOOLSET_OPTIONS } from "@agentprism/dimensions";
import { buildCapabilityOptionProjection } from "../src/capability-options.js";
import { listCustomDimensionRows } from "../src/custom-dimension-rows.js";

const CUSTOM_DIMENSION_ID = "capability_probe";

registerCustomDimensions([
  {
    id: CUSTOM_DIMENSION_ID,
    label: "Capability probe",
    subtitle: "Probe axis",
    options: [
      { value: "low", label: "Low" },
      { value: "high", label: "High" },
    ],
    default: "low",
  },
]);

describe("buildCapabilityOptionProjection", () => {
  it("covers every static toolset", () => {
    const projection = buildCapabilityOptionProjection();
    const values = new Set((projection.toolset ?? []).map((option) => option.value));
    for (const toolset of Object.keys(TOOL_NAMES_BY_TOOLSET)) {
      expect(values.has(toolset)).toBe(true);
    }
  });

  it("projects prompt, context, harness, and reasoning dimensions", () => {
    const projection = buildCapabilityOptionProjection();
    for (const dimension of ["prompt", "context", "harness", "reasoning"] as const) {
      expect(Array.isArray(projection[dimension])).toBe(true);
    }
  });

  it("returns copies, never catalog identity", () => {
    const projection = buildCapabilityOptionProjection();
    const first = (projection.toolset ?? [])[0];
    const catalogFirst = TOOLSET_OPTIONS[0];
    if (first !== undefined && catalogFirst !== undefined) {
      expect(first).not.toBe(catalogFirst);
      expect(first).toEqual(catalogFirst);
    }
  });
});

describe("custom-dimension projection", () => {
  it("gives each registered dimension its own axis, keyed by its id", () => {
    const projection = buildCapabilityOptionProjection();
    expect((projection[CUSTOM_DIMENSION_ID] ?? []).map((option) => option.value)).toEqual(["low", "high"]);
    // The option rows carry the synthetic field the baseline/router read back.
    expect((projection[CUSTOM_DIMENSION_ID] ?? [])[0]?.field).toBe(`custom.${CUSTOM_DIMENSION_ID}`);
  });

  it("keeps the builtin context rows free of custom entries", () => {
    const values = (buildCapabilityOptionProjection().context ?? []).map((row) => row.value);
    expect(values).not.toContain(CUSTOM_DIMENSION_ID);
  });

  it("drops every custom axis when ARENA_CUSTOM_DIMENSIONS=off", () => {
    const previous = process.env.ARENA_CUSTOM_DIMENSIONS;
    process.env.ARENA_CUSTOM_DIMENSIONS = "off";
    try {
      expect(buildCapabilityOptionProjection()[CUSTOM_DIMENSION_ID]).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.ARENA_CUSTOM_DIMENSIONS;
      else process.env.ARENA_CUSTOM_DIMENSIONS = previous;
    }
  });

  it("shapes the arena row with label, subtitle, field, and default", () => {
    const row = listCustomDimensionRows().find((entry) => entry.id === CUSTOM_DIMENSION_ID);
    expect(row).toEqual({
      id: CUSTOM_DIMENSION_ID,
      label: "Capability probe",
      subtitle: "Probe axis",
      field: `custom.${CUSTOM_DIMENSION_ID}`,
      default: "low",
      options: [
        { field: `custom.${CUSTOM_DIMENSION_ID}`, value: "low", label: "Low" },
        { field: `custom.${CUSTOM_DIMENSION_ID}`, value: "high", label: "High" },
      ],
    });
  });
});
