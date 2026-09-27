/**
 * @file context strategy ids test
 * @description Locks the builtin context-strategy id single source.
 *
 * Responsibilities:
 * - Pin the derived id set against the enum it is derived from
 * - Pin that custom dimension ids stay outside the builtin set
 */

import { describe, expect, it } from "vitest";
import { CONTEXT_STRATEGY_IDS, ContextStrategySchema, isBuiltinContextStrategy } from "../src/index.js";

describe("builtin context strategy ids", () => {
  it("contains exactly the schema ids", () => {
    expect([...CONTEXT_STRATEGY_IDS].sort()).toEqual([...ContextStrategySchema.options].sort());
  });

  it("recognizes every builtin id", () => {
    for (const id of ContextStrategySchema.options) {
      expect(isBuiltinContextStrategy(id)).toBe(true);
    }
  });

  it("keeps custom dimension ids outside the builtin set", () => {
    // A registered dimension id (see packages/custom) must never be mistaken for
    // a builtin strategy: registration rejects such a collision.
    expect(isBuiltinContextStrategy("summary_budget")).toBe(false);
    expect(isBuiltinContextStrategy("")).toBe(false);
    expect(isBuiltinContextStrategy("Sliding")).toBe(false);
  });
});
