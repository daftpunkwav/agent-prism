/**
 * @file workspace protect tests
 * @description Locks reentrant protection: nested holders stack, release is counted.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WorkspaceRegistry } from "../src/workspace.js";

function testRegistry() {
  const runsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-protect-"));
  let now = 0;
  const registry = new WorkspaceRegistry({
    runsRoot,
    clock: { now: () => 0 },
    monotonicNow: () => now,
    ttlSeconds: 10,
  });
  return { registry, advance: (seconds: number) => { now += seconds; } };
}

describe("WorkspaceRegistry protection counts", () => {
  it("stacks nested protects and releases one hold at a time", () => {
    const { registry } = testRegistry();
    registry.create("ws", "run-1");
    registry.protect("ws");
    registry.protect("ws");
    expect(registry.protectedCount("ws")).toBe(2);
    registry.unprotect("ws");
    expect(registry.protectedCount("ws")).toBe(1);
    registry.unprotect("ws");
    expect(registry.protectedCount("ws")).toBe(0);
    registry.unprotect("ws");
    expect(registry.protectedCount("ws")).toBe(0);
  });

  it("keeps a singly-released nested workspace out of TTL eviction", () => {
    const { registry, advance } = testRegistry();
    registry.create("ws", "run-1");
    registry.protect("ws");
    registry.protect("ws");
    advance(100);
    registry.unprotect("ws");
    // One hold left (the parent's): expiry must skip it. The successful get
    // refreshes the access clock, so advance again before the final check.
    expect(registry.get("ws")).toBeDefined();
    registry.unprotect("ws");
    advance(100);
    // No holds left: expiry reclaims it (directory removed, no rehydrate).
    expect(registry.get("ws")).toBeUndefined();
  });
});
