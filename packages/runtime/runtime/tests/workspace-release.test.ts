/**
 * @file workspace release hook tests
 * @description Locks the host seam that frees workspace-scoped OS resources.
 *
 * Responsibilities:
 * - Pin that explicit removal and both eviction paths run the release hook
 * - Pin that the hook receives the directory the resources belong to
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
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

function makeRegistry(maxWorkspaces = 2, options: { ttlSeconds?: number } = {}) {
  const runsRoot = join(mkdtempSync(join(tmpdir(), "ws-release-")), "runs");
  roots.push(runsRoot);
  let seconds = 0;
  const released: Array<{ name: string; root: string }> = [];
  const registry = new WorkspaceRegistry({
    runsRoot,
    clock: new SystemClock(),
    maxWorkspaces,
    ttlSeconds: options.ttlSeconds ?? 10,
    monotonicNow: () => seconds,
    onRelease: (workspace) => released.push(workspace),
  });
  return { registry, released, advance: (delta: number) => { seconds += delta; } };
}

describe("WorkspaceRegistry release hook", () => {
  it("runs on explicit removal with the released directory", () => {
    const { registry, released } = makeRegistry();
    const workspace = registry.create("ws-a");
    registry.remove("ws-a");
    expect(released).toEqual([{ name: "ws-a", root: workspace.root }]);
  });

  it("runs when a workspace is reclaimed by the TTL sweep", () => {
    const { registry, released, advance } = makeRegistry(4, { ttlSeconds: 10 });
    registry.create("ws-idle");
    advance(11);
    // Any create triggers the sweep; the idle workspace must take its processes with it.
    registry.create("ws-fresh");
    expect(released.map((entry) => entry.name)).toEqual(["ws-idle"]);
  });

  it("runs when the quota forces an LRU eviction", () => {
    const { registry, released, advance } = makeRegistry(1);
    registry.create("ws-old");
    advance(1);
    registry.create("ws-new");
    expect(released.map((entry) => entry.name)).toEqual(["ws-old"]);
    expect(registry.get("ws-old")).toBeUndefined();
  });

  it("contains a throwing release hook: removal reclaims the directory and eviction keeps running", () => {
    const runsRoot = join(mkdtempSync(join(tmpdir(), "ws-release-")), "runs");
    roots.push(runsRoot);
    let seconds = 0;
    const registry = new WorkspaceRegistry({
      runsRoot,
      clock: new SystemClock(),
      maxWorkspaces: 1,
      ttlSeconds: 10,
      monotonicNow: () => seconds,
      onRelease: () => {
        throw new Error("disposer exploded");
      },
    });
    const first = registry.create("ws-a");
    // Explicit removal must still reclaim the directory despite the hook failure.
    registry.remove("ws-a");
    expect(registry.count()).toBe(0);
    expect(existsSync(first.root)).toBe(false);
    // The quota eviction path must not be wedged by the throwing hook either.
    registry.create("ws-b");
    registry.create("ws-c");
    expect(registry.count()).toBe(1);
  });
});
