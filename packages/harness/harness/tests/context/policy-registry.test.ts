/**
 * @file policy registry tests
 * @description Locks context-policy registration, lookup, and unknown-strategy rejection.
 */

import { describe, expect, it } from "vitest";
import { UnknownPromptConfigError } from "../../src/prompt/errors.js";
import {
  MapContextPolicyRegistry,
  createBuiltinContextPolicyRegistry,
} from "../../src/context/policy-registry.js";

describe("createBuiltinContextPolicyRegistry", () => {
  it("registers the six strategies with sorted ids", () => {
    expect(createBuiltinContextPolicyRegistry().listIds()).toEqual([
      "hybrid",
      "sliding",
      "summary",
      "token_budget",
      "tool_tail",
      "vector",
    ]);
  });
});

describe("MapContextPolicyRegistry", () => {
  it("rejects unknown strategies", () => {
    const registry = new MapContextPolicyRegistry();
    expect(() => registry.get("ghost" as never)).toThrow(UnknownPromptConfigError);
  });
});
