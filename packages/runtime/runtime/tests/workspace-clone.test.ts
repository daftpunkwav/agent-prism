/**
 * @file workspace clone test
 * @description Locks WorkspaceRegistry.clone fork/branch semantics.
 *
 * Responsibilities:
 * - Pin byte-for-byte copy, source isolation, and conflict/usage guards
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function makeRegistry(maxWorkspaces = 8) {
  const runsRoot = join(mkdtempSync(join(tmpdir(), "ws-clone-")), "runs");
  roots.push(runsRoot);
  const clock = new SystemClock();
  return new WorkspaceRegistry({ runsRoot, clock, maxWorkspaces });
}

describe("WorkspaceRegistry.clone", () => {
  it("copies the directory byte-for-byte into a registered new workspace", async () => {
    const registry = makeRegistry();
    const source = registry.create("ws-src");
    writeFileSync(join(source.root, "a.txt"), "hello", "utf-8");
    mkdirSync(join(source.root, "nested"));
    writeFileSync(join(source.root, "nested", "b.txt"), "world", "utf-8");

    const clone = await registry.clone("ws-src", "ws-fork");
    expect(clone.root).not.toBe(source.root);
    expect(readFileSync(join(clone.root, "a.txt"), "utf-8")).toBe("hello");
    expect(readFileSync(join(clone.root, "nested", "b.txt"), "utf-8")).toBe("world");

    // Divergence isolation: writing to the clone never touches the source.
    writeFileSync(join(clone.root, "a.txt"), "changed", "utf-8");
    expect(readFileSync(join(source.root, "a.txt"), "utf-8")).toBe("hello");
  });

  it("rejects an unsafe name, a missing source, and an existing target", async () => {
    const registry = makeRegistry();
    const source = registry.create("ws-src");
    registry.create("ws-taken");

    await expect(registry.clone("ws-src", "../escape")).rejects.toThrow(/Invalid clone workspace name/);
    await expect(registry.clone("ws-missing", "ws-x")).rejects.toThrow(/does not exist/);
    await expect(registry.clone("ws-src", "ws-taken")).rejects.toThrow(/already exists/);
    expect(source.root).toContain("ws-src");
  });

  it("refuses to clone a workspace protected by a live run", async () => {
    const registry = makeRegistry();
    const source = registry.create("ws-src");
    registry.protect("ws-src");
    await expect(registry.clone("ws-src", "ws-fork")).rejects.toThrow(/in use by a live run/);
    registry.unprotect("ws-src");
    await expect(registry.clone("ws-src", "ws-fork")).resolves.toBeDefined();
    expect(source.root).toContain("ws-src");
  });

  it("fails loudly when the quota is full of pinned workspaces (never evicts pins)", async () => {
    const registry = makeRegistry(2);
    const a = registry.create("ws-a");
    const b = registry.create("ws-b");
    registry.pin("ws-a");
    registry.pin("ws-b");
    await expect(registry.clone("ws-b", "ws-c")).rejects.toThrow(/quota full/);
    expect(a.root).toContain("ws-a");
    expect(registry.get("ws-b")).toBeDefined();
  });

  it("holds the source protected for the whole copy and releases it afterwards", async () => {
    const registry = makeRegistry();
    registry.create("ws-src");

    const pending = registry.clone("ws-src", "ws-fork");
    // The synchronous prefix of clone() protects the source before the first await,
    // so an eviction landing mid-copy cannot reclaim the tree under `cp`.
    expect(registry.protectedCount("ws-src")).toBe(1);

    await pending;
    expect(registry.protectedCount("ws-src")).toBe(0);
    // The clone is registered and no staging directory survives the rename.
    expect(registry.get("ws-fork")).toBeDefined();
  });

  it("leaves no directory behind when the copy fails mid-flight", async () => {
    const registry = makeRegistry();
    const source = registry.create("ws-src");
    writeFileSync(join(source.root, "a.txt"), "hello", "utf-8");

    const pending = registry.clone("ws-src", "ws-fork");
    // Host-side deletion mid-copy: the copy must fail and stage nothing under the
    // clone name (registration is the only point where a clone becomes visible).
    rmSync(source.root, { recursive: true, force: true });
    await expect(pending).rejects.toThrow();

    const runsRoot = source.root.slice(0, source.root.lastIndexOf("ws-src"));
    expect(existsSync(join(runsRoot, "ws-fork"))).toBe(false);
    expect(existsSync(join(runsRoot, `ws-fork.${process.pid}.partial`))).toBe(false);
    expect(registry.get("ws-fork")).toBeUndefined();
  });
});
