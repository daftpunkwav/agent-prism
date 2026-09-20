/**
 * @file workspace reuse tests
 * @description Locks follow-up reuse: name validation, file retention, eviction and restart recovery.
 */

import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRunWorkspace, resolveRunWorkspace, isReusableWorkspaceName } from "@agentprism/agent";
import { WorkspaceRegistry } from "@agentprism/runtime";

describe("resolveRunWorkspace reuse", () => {
  const clock = { now: () => 1_700_000_000_000 };

  it("rejects traversal-like client names", () => {
    expect(isReusableWorkspaceName("../../evil")).toBe(false);
    expect(isReusableWorkspaceName("a/b")).toBe(false);
    expect(isReusableWorkspaceName(".")).toBe(false);
    expect(isReusableWorkspaceName("..")).toBe(false);
    expect(isReusableWorkspaceName("ok_name_1")).toBe(true);
  });

  it("reuses a still-resident workspace and keeps files written in the first turn", () => {
    const runsRoot = join(tmpdir(), `aprism-reuse-${randomUUID()}`);
    try {
      const registry = new WorkspaceRegistry({ runsRoot, clock, ttlSeconds: 3600 });
      const first = createRunWorkspace(registry, { question: "make snake", label: "Native", runId: "run-a", clock });
      first.workspace.fs.writeFile("snake.py", "print(1)\n");
      registry.unprotect(first.name);

      const second = resolveRunWorkspace(registry, {
        question: "add scoring",
        label: "Native",
        runId: "run-b",
        clock,
        existingName: first.name,
      });
      expect(second.reused).toBe(true);
      expect(second.name).toBe(first.name);
      expect(second.workspace.fs.readFile("snake.py")).toContain("print(1)");
      expect(second.workspace.root).toBe(first.workspace.root);
    } finally {
      rmSync(runsRoot, { recursive: true, force: true });
    }
  });

  it("creates a new workspace when the prior name was evicted", () => {
    const runsRoot = join(tmpdir(), `aprism-miss-${randomUUID()}`);
    try {
      let monotonic = 0;
      const registry = new WorkspaceRegistry({
        runsRoot,
        clock,
        ttlSeconds: 1,
        monotonicNow: () => monotonic,
      });
      const first = createRunWorkspace(registry, { question: "q", label: "L", clock });
      registry.unprotect(first.name);
      monotonic = 2;
      const second = resolveRunWorkspace(registry, {
        question: "q2",
        label: "L",
        clock,
        existingName: first.name,
      });
      expect(second.reused).toBe(false);
      expect(second.name).not.toBe(first.name);
    } finally {
      rmSync(runsRoot, { recursive: true, force: true });
    }
  });

  it("rehydrates a disk workspace after a new registry instance (process restart)", () => {
    const runsRoot = join(tmpdir(), `aprism-rehydrate-${randomUUID()}`);
    try {
      const firstRegistry = new WorkspaceRegistry({ runsRoot, clock, ttlSeconds: 3600 });
      const first = createRunWorkspace(firstRegistry, { question: "make snake", label: "Native", runId: "run-a", clock });
      first.workspace.fs.writeFile("snake.py", "print(1)\n");
      firstRegistry.unprotect(first.name);

      const secondRegistry = new WorkspaceRegistry({ runsRoot, clock, ttlSeconds: 3600 });
      const restored = secondRegistry.get(first.name);
      expect(restored).toBeDefined();
      expect(restored?.fs.readFile("snake.py")).toContain("print(1)");

      const followUp = resolveRunWorkspace(secondRegistry, {
        question: "add scoring",
        label: "Native",
        runId: "run-b",
        clock,
        existingName: first.name,
      });
      expect(followUp.reused).toBe(true);
      expect(followUp.name).toBe(first.name);
      expect(followUp.workspace.fs.readFile("snake.py")).toContain("print(1)");
    } finally {
      rmSync(runsRoot, { recursive: true, force: true });
    }
  });
});

