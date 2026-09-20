/**
 * @file scoped symlink guards tests
 * @description Locks symlink-escape blocking on read/write/delete/list paths.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, lstatSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ScopedFileSystem } from "@agentprism/environment";

function makeRoot(): string {
  const root = join(tmpdir(), `aprism-fs-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

/** Windows uses junction (no privilege); POSIX uses a directory symlink; returns false without permission. */
function tryLink(outside: string, linkPath: string): boolean {
  try {
    symlinkSync(outside, linkPath, process.platform === "win32" ? "junction" : "dir");
    return true;
  } catch {
    return false;
  }
}

describe("ScopedFileSystem symlink guards", () => {
  it("write/read targeting a link outside the root is rejected", () => {
    const root = makeRoot();
    const outside = join(tmpdir(), `aprism-outside-${randomUUID()}`);
    mkdirSync(outside, { recursive: true });
    const fs = new ScopedFileSystem(root);
    const linked = tryLink(outside, join(root, "escape"));
    if (linked) {
      expect(() => fs.writeFile("escape/x.txt", "x")).toThrow(/escapes root/);
      expect(() => fs.readFile("escape/x.txt")).toThrow(/escapes root|not found/);
    }
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("delete via a symlink pointing outside the root is rejected", () => {
    const root = makeRoot();
    const outside = join(tmpdir(), `aprism-outside-${randomUUID()}`);
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "victim.txt"), "x");
    const fs = new ScopedFileSystem(root);
    const linked = tryLink(outside, join(root, "escape"));
    if (linked) {
      // unlink resolves through the parent link segment onto the outside file; must be asserted
      expect(() => fs.deleteFile("escape/victim.txt")).toThrow(/escapes root/);
    }
    // In-root ordinary deletes are unaffected
    fs.writeFile("normal.txt", "x");
    expect(fs.deleteFile("normal.txt")).toContain("Deleted");
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("write through a dangling symlink target is rejected (regression: realpath ENOENT escape)", () => {
    // Windows junctions cannot point at a missing target (create fails); dangling escape is POSIX-only
    if (process.platform === "win32") return;
    const root = makeRoot();
    const fs = new ScopedFileSystem(root);
    // Link points at a missing target: realpath throws ENOENT, but write would still follow outside the root
    symlinkSync(join(tmpdir(), `aprism-missing-${randomUUID()}`), join(root, "dangling"));
    expect(() => fs.writeFile("dangling", "x")).toThrow(/escapes root/);
    // Deeper paths under a dangling link segment are also rejected: ancestor walk must not skip dangling as "missing middle"
    expect(() => fs.writeFile("dangling/sub/deep.txt", "x")).toThrow(/escapes root/);
    // In-root creates are unaffected
    expect(fs.createFile("fresh.txt", "x")).toContain("Wrote");
    rmSync(root, { recursive: true, force: true });
  });

  it("listing a base directory that is a symlink returns empty (no outside structure leak)", () => {
    const root = makeRoot();
    const outside = join(tmpdir(), `aprism-outside-${randomUUID()}`);
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "secret.txt"), "x");
    const fs = new ScopedFileSystem(root);
    const linked = tryLink(outside, join(root, "peek"));
    if (linked) {
      expect(fs.listFiles("peek")).toEqual([]);
      expect(fs.listFiles("peek", { recursive: true })).toEqual([]);
    }
    // In-root listing is unaffected
    fs.writeFile("ok.txt", "x");
    expect(fs.listFiles("")).toContain("ok.txt");
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("directory cycles do not hang listing", () => {
    const root = makeRoot();
    const fs = new ScopedFileSystem(root);
    fs.writeFile("inside/a.txt", "x");
    const linked = tryLink(root, join(root, "loop"));
    if (linked && lstatSync(join(root, "loop")).isSymbolicLink()) {
      expect(fs.listFiles("", { recursive: true })).toEqual(["inside/a.txt"]);
    }
    rmSync(root, { recursive: true, force: true });
  });

  it(".. segments that escape the root are rejected immediately", () => {
    const root = makeRoot();
    const fs = new ScopedFileSystem(root);
    expect(fs.canonicalize("../secret.txt")).toBeNull();
    expect(fs.canonicalize("a/../../b")).toBeNull();
    rmSync(root, { recursive: true, force: true });
  });

  it("multi-level new paths via a link ancestor are rejected (regression: missing parent must not skip asserts)", () => {
    const root = makeRoot();
    const outside = join(tmpdir(), `aprism-outside-${randomUUID()}`);
    mkdirSync(outside, { recursive: true });
    const fs = new ScopedFileSystem(root);
    const linked = tryLink(outside, join(root, "escape"));
    if (linked) {
      // Direct parent escape/sub does not exist: old impl skipped asserts here; mkdirSync(recursive) escaped outside via the link
      expect(() => fs.writeFile("escape/sub/x.txt", "x")).toThrow(/escapes root/);
      expect(() => fs.createFile("escape/sub/y.txt", "y")).toThrow(/escapes root/);
      expect(existsSync(join(outside, "sub"))).toBe(false);
    }
    // In-root multi-level creates are unaffected
    expect(fs.writeFile("fresh/dir/x.txt", "x")).toContain("Wrote");
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("in-root read/write/edit are unaffected", () => {
    const root = makeRoot();
    const fs = new ScopedFileSystem(root);
    fs.writeFile("a/b.txt", "hello");
    expect(fs.readFile("a/b.txt")).toBe("hello");
    expect(fs.editFile("a/b.txt", "hello", "world")).toContain("Edited");
    expect(fs.readFile("a/b.txt")).toBe("world");
    rmSync(root, { recursive: true, force: true });
  });
});

