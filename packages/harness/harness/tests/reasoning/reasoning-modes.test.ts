/**
 * @file reasoning modes tests
 * @description Covers reasoning-mode metadata lookup and suffix injection.
 *
 * Responsibilities:
 * - Pin that every declared mode exposes a description and suffix pair
 * - Lock fail-closed behavior on unknown modes
 */

import { describe, expect, it } from "vitest";
import { REASONING_MODES, applyReasoningMode, getReasoningDescription } from "../../src/reasoning/reasoning-modes.js";

describe("reasoning modes", () => {
  const first = REASONING_MODES[0]!;
  it("declares suffixes for every mode in the metadata table", () => {
    expect(REASONING_MODES.length).toBeGreaterThan(0);
    for (const spec of REASONING_MODES) {
      expect(spec.description).not.toBe("");
      expect(typeof spec.systemSuffix).toBe("string");
      expect(typeof spec.userSuffix).toBe("string");
    }
  });

  it("appends mode suffixes to the base system and user text", () => {
    const applied = applyReasoningMode("SYS", "USR", first.mode);
    expect(applied.system.startsWith("SYS")).toBe(true);
    expect(applied.system).toContain(first.systemSuffix);
    expect(applied.user.startsWith("USR")).toBe(true);
  });

  it("fails closed on unknown modes for both lookup entries", () => {
    expect(() => applyReasoningMode("S", "U", "nonsense")).toThrow(/nonsense/);
    expect(() => getReasoningDescription("nonsense")).toThrow(/nonsense/);
  });

  it("describes a known mode via its metadata", () => {
    expect(getReasoningDescription(first.mode)).toBe(first.description);
  });
});
