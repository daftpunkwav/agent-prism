/**
 * @file decode option tests
 * @description Keeps dimensions token tables in sync with contracts.
 *
 * Responsibilities:
 * - Compare every string token table against the contracts option lists
 */

import { describe, expect, it } from "vitest";
import {
  MAX_OUTPUT_TOKENS_OPTIONS,
  PENALTY_OPTIONS,
  TEMPERATURE_OPTIONS,
  TOP_P_OPTIONS,
} from "@agentprism/contracts";
import { BASELINE_ONLY_OPTIONS } from "@agentprism/dimensions";

/** Dimension field → contracts option table (guards string view vs numeric single source). */
const FIELD_TO_OPTIONS: Record<string, readonly number[]> = {
  top_p: TOP_P_OPTIONS,
  frequency_penalty: PENALTY_OPTIONS,
  presence_penalty: PENALTY_OPTIONS,
  max_output_tokens: MAX_OUTPUT_TOKENS_OPTIONS,
};

describe("dimensions string option tables match contracts numeric single source", () => {
  it("every numeric decode token exists in the contracts numeric table", () => {
    // Scoped to the numeric decode fields: safety control fields (approval_mode,
    // sandbox_mode) are string enums with no contracts numeric table.
    for (const [field, allowed] of Object.entries(FIELD_TO_OPTIONS)) {
      const pairs = BASELINE_ONLY_OPTIONS[field];
      expect(pairs, `field ${field} missing from the string view`).toBeDefined();
      for (const [value] of pairs ?? []) {
        expect(allowed).toContain(Number(value));
      }
    }
  });

  it("contracts option tables have no tokens missing from the string view", () => {
    for (const [field, allowed] of Object.entries(FIELD_TO_OPTIONS)) {
      const tokens = (BASELINE_ONLY_OPTIONS[field] ?? []).map(([value]) => Number(value));
      for (const num of allowed) {
        expect(tokens, `field ${field} option ${num} not in string view`).toContain(num);
      }
    }
  });

  it("temperature option contract remains the baseline snap range upper bound reference", () => {
    expect(TEMPERATURE_OPTIONS.every((t) => t >= 0 && t <= 2)).toBe(true);
  });
});
