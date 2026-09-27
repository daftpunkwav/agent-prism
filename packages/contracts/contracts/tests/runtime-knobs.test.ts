/**
 * @file runtime knobs tests
 * @description Locks the operator-knob → run-spec mapping for harness retry caps.
 *
 * Responsibilities:
 * - Pin the wire key (selfEvolve) onto the harness level token (self_evolve)
 * - Pin that every mapped key is a legal harness level token
 */

import { describe, expect, it } from "vitest";
import { HarnessLevelSchema, harnessRetryCaps } from "../src/index.js";

describe("harnessRetryCaps", () => {
  it("maps the knob's camelCase selfEvolve onto the self_evolve level token", () => {
    const caps = harnessRetryCaps({ verify: 1, reflect: 4, selfEvolve: 3 });
    expect(caps).toEqual({ verify: 1, reflect: 4, self_evolve: 3 });
    // The verification loop looks the cap up as maxRetries[level]: a camelCase
    // key here typechecks but is never read, silently disabling the operator cap.
    for (const key of Object.keys(caps)) {
      expect(HarnessLevelSchema.safeParse(key).success).toBe(true);
    }
  });
});
