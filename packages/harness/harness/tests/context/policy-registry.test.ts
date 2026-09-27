/**
 * @file policy registry tests
 * @description Locks context-policy registration, lookup, and unknown-strategy rejection.
 */

import { describe, expect, it } from "vitest";
import { ContextStrategySchema } from "@agentprism/contracts";
import { UnknownPromptConfigError } from "../../src/prompt/errors.js";
import {
  MapContextPolicyRegistry,
  createBuiltinContextPolicyRegistry,
} from "../../src/context/policy-registry.js";

describe("createBuiltinContextPolicyRegistry", () => {
  it("registers every builtin strategy the pipeline can dispatch", () => {
    // Same set as the pipeline's dispatch list: a strategy the pipeline runs must
    // also resolve through the port (the Arena catalog decides which are exposed).
    expect(createBuiltinContextPolicyRegistry().listIds()).toEqual(
      [...ContextStrategySchema.options].sort(),
    );
  });
});

describe("MapContextPolicyRegistry", () => {
  it("rejects unknown strategies", () => {
    const registry = new MapContextPolicyRegistry();
    expect(() => registry.get("ghost" as never)).toThrow(UnknownPromptConfigError);
  });
});
