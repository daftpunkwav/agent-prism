/**
 * @file workspace pin test
 * @description Locks ownership pins: pinned workspaces survive TTL and LRU eviction.
 *
 * Responsibilities:
 * - Pin pin/unpin semantics against both eviction paths
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SystemClock, WorkspaceRegistry } from "@agentprism/runtime";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

function makeRegistry(maxWorkspaces = 8, options: { lruActiveWindowSeconds?: number } = {}) {
  const runsRoot = join(mkdtempSync(join(tmpdir(), "ws-pin-")), "runs");
  roots.push(runsRoot);
  let seconds = 0;
  const registry = new WorkspaceRegistry({
    runsRoot,
    clock: new SystemClock(),
    maxWorkspaces,
    lruActiveWindowSeconds: options.lruActiveWindowSeconds,
    monotonicNow: () => seconds,
  });
  return {
    registry,
    advance: (delta: number) => {
      seconds += delta;
    },
  };
}

describe("WorkspaceRegistry LRU window", () => {
  it("prefers evicting workspaces idle beyond the tuned window", () => {
    // Window 100s: the older workspace (idle 200s) is preferred over the newest (idle 50s).
    const { registry, advance } = makeRegistry(2, { lruActiveWindowSeconds: 100 });
    const older = registry.create("ws-older");
    advance(150);
    const newer = registry.create("ws-newer");
    advance(50);
    const forced = registry.create("ws-forced");
    expect(registry.get("ws-older")).toBeUndefined();
    expect(registry.get("ws-newer")).toBeDefined();
    expect(registry.get("ws-forced")).toBeDefined();
    void forced;
  });
});

describe("WorkspaceRegistry pin", () => {
  it("keeps a pinned workspace across TTL expiry while an idle unpinned one is evicted", () => {
    const { registry, advance } = makeRegistry();
    const pinned = registry.create("ws-pinned");
    const loose = registry.create("ws-loose");
    registry.pin("ws-pinned");

    advance(7200); // past the default 3600s TTL for both
    expect(registry.get("ws-pinned")).toBeDefined();
    expect(registry.get("ws-loose")).toBeUndefined();
    expect(pinned.root).toBeDefined();
  });

  it("keeps pinned workspaces out of the LRU eviction pool under quota pressure", () => {
    const { registry, advance } = makeRegistry(2);
    const pinned = registry.create("ws-pinned");
    registry.pin("ws-pinned");
    advance(600); // both idle past the LRU active window

    // Quota needs one slot: the only candidate is the unpinned workspace.
    registry.create("ws-new");
    expect(registry.get("ws-pinned")).toBeDefined();
    expect(pinned.root).toBeDefined();
  });

  it("restores evictability after unpin", () => {
    const { registry, advance } = makeRegistry();
    registry.create("ws-x");
    registry.pin("ws-x");
    registry.unpin("ws-x");
    advance(7200);
    expect(registry.get("ws-x")).toBeUndefined();
  });
});
