/**
 * @file workspace trace link tests
 * @description Locks the run↔workspace disk associations of WorkspaceRegistry:
 * run-id lookup, per-run trace directories, the workspace marker, and disk
 * rehydration after a restart.
 *
 * These are the read-side links behind the run log page: a wrong or missing
 * link silently shows an empty log instead of failing.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
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

function makeRegistry(options: { maxWorkspaces?: number; ttlSeconds?: number } = {}) {
  const base = mkdtempSync(join(tmpdir(), "ws-trace-"));
  roots.push(base);
  const runsRoot = join(base, "runs");
  return {
    runsRoot,
    registry: new WorkspaceRegistry({
      runsRoot,
      clock: new SystemClock(),
      maxWorkspaces: options.maxWorkspaces ?? 8,
      ttlSeconds: options.ttlSeconds,
    }),
  };
}

describe("WorkspaceRegistry.runIdOf", { retry: 1 }, () => {
  it("reports the run directory a resident workspace lives under", () => {
    const { registry, runsRoot } = makeRegistry();
    registry.create("ws-a");
    const runId = registry.runIdOf("ws-a");
    expect(runId).toBeTruthy();
    expect(existsSync(join(runsRoot, runId as string, "ws-a"))).toBe(true);
    expect(registry.runIdOf("ws-unknown")).toBeNull();
  });
});

describe("WorkspaceRegistry.traceDir", { retry: 1 }, () => {
  it("creates the per-run trace directory on demand and refuses an unsafe run id", () => {
    const { registry, runsRoot } = makeRegistry();
    const dir = registry.traceDir("run-1");
    expect(dir).toBe(join(runsRoot, "run-1", "_traces"));
    expect(statSync(dir).isDirectory()).toBe(true);
    // Second call is idempotent (mkdir recursive).
    expect(registry.traceDir("run-1")).toBe(dir);
    expect(() => registry.traceDir("../escape")).toThrow(/Invalid run id for trace dir/);
  });
});

describe("WorkspaceRegistry.traceDirsForWorkspace", { retry: 1 }, () => {
  it("returns nothing for an unsafe name or a missing runs root", () => {
    const { registry } = makeRegistry();
    expect(registry.traceDirsForWorkspace("../escape")).toEqual([]);
    // The runs root does not exist until the first workspace is created.
    expect(registry.traceDirsForWorkspace("ws-a")).toEqual([]);
  });

  it("finds the runs holding a workspace copy and orders them oldest first", () => {
    const { registry, runsRoot } = makeRegistry();
    mkdirSync(join(runsRoot, "run-b", "ws-a"), { recursive: true });
    mkdirSync(join(runsRoot, "run-b", "_traces"), { recursive: true });
    mkdirSync(join(runsRoot, "run-a", "ws-a"), { recursive: true });
    mkdirSync(join(runsRoot, "run-a", "_traces"), { recursive: true });
    // Explicit times: the ordering under test is the run directory's mtime.
    utimesSync(join(runsRoot, "run-b"), new Date(2_000), new Date(2_000));
    utimesSync(join(runsRoot, "run-a"), new Date(1_000), new Date(1_000));

    const dirs = registry.traceDirsForWorkspace("ws-a");
    expect(dirs).toEqual([join(runsRoot, "run-a", "_traces"), join(runsRoot, "run-b", "_traces")]);
  });

  it("links a follow-up run through its marker when no workspace copy exists", () => {
    const { registry, runsRoot } = makeRegistry();
    // The follow-up run reuses the resident workspace: no copy, only the marker.
    mkdirSync(join(runsRoot, "run-later", "_traces"), { recursive: true });
    writeFileSync(join(runsRoot, "run-later", "_traces", "ws-a.ws"), "", "utf-8");
    expect(registry.traceDirsForWorkspace("ws-a")).toEqual([join(runsRoot, "run-later", "_traces")]);
  });

  it("skips runs with neither a copy nor a marker, and runs without a trace directory", () => {
    const { registry, runsRoot } = makeRegistry();
    mkdirSync(join(runsRoot, "run-unrelated", "ws-other"), { recursive: true });
    mkdirSync(join(runsRoot, "run-unrelated", "_traces"), { recursive: true });
    // A workspace copy without its trace directory contributes nothing.
    mkdirSync(join(runsRoot, "run-notraces", "ws-a"), { recursive: true });
    // A file where a run directory is expected is not a run.
    writeFileSync(join(runsRoot, "stray.txt"), "", "utf-8");
    expect(registry.traceDirsForWorkspace("ws-a")).toEqual([]);
  });
});

describe("WorkspaceRegistry.associateTrace", { retry: 1 }, () => {
  it("drops the marker once and ignores an unsafe workspace name", () => {
    const { registry, runsRoot } = makeRegistry();
    registry.associateTrace("run-1", "ws-a");
    const marker = join(runsRoot, "run-1", "_traces", "ws-a.ws");
    expect(existsSync(marker)).toBe(true);
    // Re-associating an existing marker is a no-op, not an error.
    registry.associateTrace("run-1", "ws-a");
    expect(existsSync(marker)).toBe(true);
    registry.associateTrace("run-2", "../escape");
    expect(existsSync(join(runsRoot, "run-2"))).toBe(false);
  });
});

describe("WorkspaceRegistry rehydration from disk", { retry: 1 }, () => {
  it("reattaches a workspace that survived a restart", () => {
    const { registry, runsRoot } = makeRegistry();
    const created = registry.create("ws-a");
    writeFileSync(join(created.root, "keep.txt"), "kept", "utf-8");

    // A fresh registry over the same runs root has an empty in-memory map.
    const restarted = new WorkspaceRegistry({ runsRoot, clock: new SystemClock(), maxWorkspaces: 8 });
    const restored = restarted.get("ws-a");
    expect(restored?.root).toBe(created.root);
    expect(existsSync(join(restored?.root ?? "", "keep.txt"))).toBe(true);
  });

  it("ignores unsafe names, non-directories, and a missing runs root", () => {
    const { registry, runsRoot } = makeRegistry();
    registry.create("ws-a");
    writeFileSync(join(runsRoot, "not-a-run"), "", "utf-8");
    mkdirSync(join(runsRoot, "run-x"), { recursive: true });
    writeFileSync(join(runsRoot, "run-x", "ws-file"), "", "utf-8");

    const restarted = new WorkspaceRegistry({ runsRoot, clock: new SystemClock(), maxWorkspaces: 8 });
    expect(restarted.get("../escape")).toBeUndefined();
    expect(restarted.get("ws-file")).toBeUndefined();

    const empty = new WorkspaceRegistry({
      runsRoot: join(runsRoot, "absent"),
      clock: new SystemClock(),
      maxWorkspaces: 8,
    });
    expect(empty.get("ws-a")).toBeUndefined();
  });
});
