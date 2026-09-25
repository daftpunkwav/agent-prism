/**
 * @file capability options tests
 * @description Locks capability projection: live-registry gating and static toolsets.
 */

import { describe, expect, it } from "vitest";
import { TOOL_NAMES_BY_TOOLSET } from "@agentprism/contracts";
import { TOOLSET_OPTIONS } from "@agentprism/dimensions";
import { buildCapabilityOptionProjection } from "../src/capability-options.js";

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
