/**
 * @file registry tests
 * @description Locks driver registration validation.
 *
 * Responsibilities:
 * - Pin fail-closed registration (blank identities)
 */

import { describe, expect, it } from "vitest";
import { FrameworkDriverRegistry } from "../src/registry.js";

function stubDriver(overrides: Record<string, unknown> = {}) {
  return {
    frameworkId: "stub",
    displayName: "Stub",
    async *run() {},
    ...overrides,
  };
}

describe("FrameworkDriverRegistry.register", () => {
  it("rejects drivers with blank frameworkId or displayName", () => {
    const registry = new FrameworkDriverRegistry();
    expect(() => registry.register(stubDriver({ frameworkId: "" }) as never)).toThrow(TypeError);
    expect(() => registry.register(stubDriver({ displayName: "" }) as never)).toThrow(TypeError);
    expect(() => registry.register(stubDriver() as never)).not.toThrow();
  });
});
