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

describe("validateComposition claude sdk endpoint gate", () => {
  const base = { availableFrameworks: ["native", "claude_agent_sdk"], knownTools: [...DEFAULT_BUILDER_TOOLS] };
  const formats = { endpointApiFormats: { "ep-anthropic": "anthropic_messages", "ep-openai": "openai_chat" } };

  it("accepts claude_agent_sdk on an anthropic endpoint, explicit or default", () => {
    expect(() =>
      validateComposition(baseComposition({ framework: "claude_agent_sdk", endpoint_id: "ep-anthropic" }), {
        ...base,
        ...formats,
      }),
    ).not.toThrow();
    expect(() =>
      validateComposition(baseComposition({ framework: "claude_agent_sdk", endpoint_id: "" }), {
        ...base,
        ...formats,
        defaultEndpointId: "ep-anthropic",
      }),
    ).not.toThrow();
  });

  it("rejects claude_agent_sdk on a non-anthropic endpoint, explicit or default", () => {
    expect(() =>
      validateComposition(baseComposition({ framework: "claude_agent_sdk", endpoint_id: "ep-openai" }), {
        ...base,
        ...formats,
      }),
    ).toThrow(/claude_agent_sdk/);
    expect(() =>
      validateComposition(baseComposition({ framework: "claude_agent_sdk", endpoint_id: "" }), {
        ...base,
        ...formats,
        defaultEndpointId: "ep-openai",
      }),
    ).toThrow(/anthropic_messages/);
  });

  it("leaves other frameworks and format-less indexes untouched", () => {
    // Another framework on the same non-anthropic endpoint is fine.
    expect(() =>
      validateComposition(baseComposition({ framework: "native", endpoint_id: "ep-openai" }), { ...base, ...formats }),
    ).not.toThrow();
    // Callers without format facts keep the old behavior (turn-time driver error).
    expect(() =>
      validateComposition(baseComposition({ framework: "claude_agent_sdk", endpoint_id: "ep-openai" }), base),
    ).not.toThrow();
  });

  it("never resolves a format through the prototype chain", () => {
    // "toString" is not a known endpoint, so the existence check rejects first;
    // an index that knows it must still not read the inherited member as a format.
    expect(() =>
      validateComposition(baseComposition({ framework: "claude_agent_sdk", endpoint_id: "toString" }), {
        ...base,
        ...formats,
        knownEndpointIds: ["ep-anthropic", "ep-openai"],
      }),
    ).toThrow(/toString/);
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

