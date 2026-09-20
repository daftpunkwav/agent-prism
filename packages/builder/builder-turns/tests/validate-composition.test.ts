/**
 * @file validate-composition tests
 * @description Locks framework/tool/endpoint validation against the live index.
 */

import { describe, expect, it } from "vitest";
import type { BuilderComposition } from "@agentprism/contracts";
import { DEFAULT_BUILDER_TOOLS, normalizeComposition, validateComposition } from "../src/composition.js";

function baseComposition(overrides: Partial<BuilderComposition> = {}): BuilderComposition {
  return { ...normalizeComposition({}), ...overrides };
}

describe("validateComposition", () => {
  // The index knows the default working set: base compositions carry it since
  // omitted tools default to DEFAULT_BUILDER_TOOLS, not to empty.
  const index = { availableFrameworks: ["native", "langchain"], knownTools: [...DEFAULT_BUILDER_TOOLS] };

  it("accepts a legal composition", () => {
    expect(() =>
      validateComposition(baseComposition({ framework: "langchain", tools: ["read"] }), index),
    ).not.toThrow();
  });

  it("rejects unknown frameworks and tools with the offender named", () => {
    expect(() => validateComposition(baseComposition({ framework: "autogen" }), index)).toThrow(/autogen/);
    expect(() => validateComposition(baseComposition({ tools: ["teleport"] }), index)).toThrow(/teleport/);
  });

  it("rejects unknown endpoint ids only when the caller supplies the live list", () => {
    const withEndpoints = { ...index, knownEndpointIds: ["ep-1"] };
    // Empty endpoint_id always means the provider default, regardless of the list.
    expect(() => validateComposition(baseComposition({ endpoint_id: "" }), withEndpoints)).not.toThrow();
    expect(() => validateComposition(baseComposition({ endpoint_id: "ep-1" }), withEndpoints)).not.toThrow();
    expect(() => validateComposition(baseComposition({ endpoint_id: "ghost" }), withEndpoints)).toThrow(/ghost/);
    // Callers without endpoint visibility keep the old behavior (checked at turn time).
    expect(() => validateComposition(baseComposition({ endpoint_id: "ghost" }), index)).not.toThrow();
  });
});

