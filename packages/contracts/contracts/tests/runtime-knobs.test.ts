/**
 * @file runtime knobs tests
 * @description Locks the operator-knob → run-spec mapping for harness retry caps.
 *
 * Responsibilities:
 * - Pin the wire key (selfEvolve) onto the harness level token (self_evolve)
 * - Pin that every mapped key is a legal harness level token
 */

import { describe, expect, it } from "vitest";
import { HarnessLevelSchema, harnessRetryCaps, RUNTIME_KNOB_FIELDS, staticDefaultRuntimeKnobs } from "../src/index.js";

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

describe("staticDefaultRuntimeKnobs", () => {
  it("keeps every static default equal to its field metadata default", () => {
    // The settings UI reset writes meta.default; a static default drifting from
    // the metadata (or from the config env defaults) would silently reset that
    // knob to a different value. Flattened lookup mirrors the dotted harness keys.
    const knobs = staticDefaultRuntimeKnobs();
    for (const field of RUNTIME_KNOB_FIELDS) {
      const parts = field.key.split(".");
      let value: unknown = knobs;
      for (const part of parts) {
        if (typeof value !== "object" || value === null || !Object.hasOwn(value, part)) {
          value = undefined;
          break;
        }
        value = Reflect.get(value, part);
      }
      expect(value, `static default for ${field.key}`).toBe(field.default);
    }
  });
});
