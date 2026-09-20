/**
 * @file workspace quota tests
 * @description Locks the registry quota guard: degenerate limits fall back to safe defaults.
 */

import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceRegistry } from "@agentprism/runtime";

describe("WorkspaceRegistry quota guard", () => {
  it("NaN maxWorkspaces falls back to the default instead of disabling the quota", () => {
    const runsRoot = join(tmpdir(), `aprism-nan-${randomUUID()}`);
    try {
      const registry = new WorkspaceRegistry({
        runsRoot,
        clock: { now: () => 1_700_000_000_000 },
        maxWorkspaces: NaN,
      });
      registry.create("ws-a", "run-1");
      registry.create("ws-b", "run-1");
      expect(registry.count()).toBe(2);
    } finally {
      rmSync(runsRoot, { recursive: true, force: true });
    }
  });
});
