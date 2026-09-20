/**
 * @file workspace registry limits tests
 * @description Locks registry root constraints: fail-fast creation, TTL, rollback.
 */

import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRunWorkspace } from "@agentprism/agent";
import { WorkspaceRegistry } from "@agentprism/runtime";

describe("WorkspaceRegistry root constraints", () => {
  const clock = { now: () => 0 };

  it("create fail-fast on out-of-root name", () => {
    const runsRoot = join(tmpdir(), `aprism-test-${randomUUID()}`);
    try {
      const registry = new WorkspaceRegistry({ runsRoot, clock });
      expect(() => registry.create("../../evil")).toThrow("Workspace path escapes runs root");
    } finally {
      rmSync(runsRoot, { recursive: true, force: true });
    }
  });

  it("create fail-fast on out-of-root runId and does not write disk", () => {
    const runsRoot = join(tmpdir(), `aprism-test-${randomUUID()}`);
    try {
      const registry = new WorkspaceRegistry({ runsRoot, clock });
      expect(() => registry.create("ok-name", "../../escape")).toThrow("Workspace path escapes runs root");
      expect(registry.count()).toBe(0);
    } finally {
      rmSync(runsRoot, { recursive: true, force: true });
    }
  });

  it("fail-fast when quota is full and nothing can be evicted", () => {
    const runsRoot = join(tmpdir(), `aprism-test-${randomUUID()}`);
    try {
      const registry = new WorkspaceRegistry({ runsRoot, maxWorkspaces: 1, clock });
      registry.protect("occupied");
      registry.create("occupied");
      expect(() => registry.create("another")).toThrow(/quota full/i);
      expect(registry.count()).toBe(1);
    } finally {
      rmSync(runsRoot, { recursive: true, force: true });
    }
  });

  it("TTL eviction uses monotonic clock and accepts an injected clock", () => {
    const runsRoot = join(tmpdir(), `aprism-test-${randomUUID()}`);
    try {
      let monotonic = 0;
      const registry = new WorkspaceRegistry({
        runsRoot,
        clock: { now: () => 0 },
        ttlSeconds: 1,
        monotonicNow: () => monotonic,
      });
      const created = registry.create("ttl-probe");
      expect(registry.get("ttl-probe")).toBeDefined();
      monotonic = 2; // past 1s TTL
      expect(registry.get("ttl-probe")).toBeUndefined();
      expect(registry.count()).toBe(0);
      expect(created.root).toContain("ttl-probe");
    } finally {
      rmSync(runsRoot, { recursive: true, force: true });
    }
  });

  it("createRunWorkspace rolls back protect mark when create fails", () => {
    const runsRoot = join(tmpdir(), `aprism-test-${randomUUID()}`);
    try {
      const registry = new WorkspaceRegistry({ runsRoot, clock });
      expect(() =>
        createRunWorkspace(registry, { question: "q", label: "L", runId: "../escape", clock }),
      ).toThrow();
      // After rollback the registry has no leftover workspace; later creates still work.
      expect(registry.count()).toBe(0);
      const created = createRunWorkspace(registry, { question: "q", label: "L", clock });
      expect(created.workspace.name).toBeTruthy();
    } finally {
      rmSync(runsRoot, { recursive: true, force: true });
    }
  });
});

