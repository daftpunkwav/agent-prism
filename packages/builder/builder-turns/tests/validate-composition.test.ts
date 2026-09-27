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

describe("validateComposition custom dimensions", () => {
  const index = {
    availableFrameworks: ["native"],
    knownTools: [...DEFAULT_BUILDER_TOOLS],
    customDimensionValues: { summary_budget: ["2000", "8000"] },
  };

  it("accepts a registered dimension with one of its own values", () => {
    expect(() => validateComposition(baseComposition({ custom: { summary_budget: "8000" } }), index)).not.toThrow();
  });

  it("rejects an unregistered block and an unsupported value as invalid input", () => {
    expect(() => validateComposition(baseComposition({ custom: { ghost_axis: "x" } }), index)).toThrow(/ghost_axis/);
    expect(() => validateComposition(baseComposition({ custom: { summary_budget: "9999" } }), index)).toThrow(
      /unsupported value/,
    );
  });

  it("treats a prototype-named key as an unknown block, never as a crash", () => {
    // Keys are only length-bounded, so "toString" reaches this check: reading it
    // off the index would find Object.prototype's member and throw a TypeError
    // (an HTTP 500) instead of the 422 an unknown block deserves.
    for (const key of ["toString", "constructor", "hasOwnProperty"]) {
      expect(() => validateComposition(baseComposition({ custom: { [key]: "x" } }), index)).toThrow(
        /Unknown custom dimension block/,
      );
    }
  });
});

