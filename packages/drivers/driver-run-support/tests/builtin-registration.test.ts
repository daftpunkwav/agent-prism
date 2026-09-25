/**
 * @file builtin-registration tests
 * @description Locks best-effort driver registration semantics.
 *
 * Responsibilities:
 * - Pin all-loaders-register, failing-loader-skips, and empty-list no-op
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentDriver } from "@agentprism/contracts";
import { FrameworkDriverRegistry, registerDriversBestEffort } from "../src/index.js";

function stubDriver(frameworkId: string): AgentDriver {
  return {
    frameworkId,
    displayName: frameworkId,
    async *run() {},
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("registerDriversBestEffort", () => {
  it("registers every loaded driver", async () => {
    const registry = new FrameworkDriverRegistry();
    await registerDriversBestEffort(registry, [
      { name: "First", load: async () => stubDriver("first") },
      { name: "Second", load: async () => stubDriver("second") },
    ]);
    expect(registry.listAvailable().map((d) => d.id).sort()).toEqual(["first", "second"]);
  });

  it("warns and skips a failing loader without blocking the rest", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = new FrameworkDriverRegistry();
    await registerDriversBestEffort(registry, [
      { name: "Broken", load: async () => { throw new Error("boom"); } },
      { name: "Healthy", load: async () => stubDriver("healthy") },
    ]);
    expect(registry.listAvailable().map((d) => d.id)).toEqual(["healthy"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("Broken");
  });

  it("is a no-op for an empty loader list", async () => {
    const registry = new FrameworkDriverRegistry();
    await expect(registerDriversBestEffort(registry, [])).resolves.toBeUndefined();
    expect(registry.listAvailable()).toEqual([]);
  });
});
