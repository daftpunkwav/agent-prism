/**
 * @file sandbox mode test
 * @description Locks sandbox mode normalization fail-safe behavior.
 *
 * Responsibilities:
 * - Pin valid mode passthrough and the off fallback for unknown values
 */

import { describe, expect, it } from "vitest";
import { normalizeSandboxMode } from "../src/index.js";

describe("normalizeSandboxMode", () => {
  it("passes valid modes through", () => {
    expect(normalizeSandboxMode("off")).toBe("off");
    expect(normalizeSandboxMode("os")).toBe("os");
  });

  it("falls back to off on unknown values (containment is opt-in, never silently enabled)", () => {
    expect(normalizeSandboxMode("yolo")).toBe("off");
    expect(normalizeSandboxMode(undefined)).toBe("off");
    expect(normalizeSandboxMode(null)).toBe("off");
    expect(normalizeSandboxMode("")).toBe("off");
  });
});
