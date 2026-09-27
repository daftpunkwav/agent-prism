/**
 * @file scoped path legality tests
 * @description Locks the path-string gate of ScopedFileSystem: which inputs
 * canonicalize rejects outright, how every entry point reports them, and the
 * listing filters that keep workspace-relative paths clean.
 *
 * This is the shape gate; the symlink/escape guards it feeds are covered by
 * scoped-symlink-guards.test.ts.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ScopedFileSystem, WorkspaceError } from "@agentprism/environment";

function makeRoot(): string {
  const root = join(tmpdir(), `aprism-fs-path-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function withRoot(assert: (fs: ScopedFileSystem, root: string) => void): void {
  const root = makeRoot();
  try {
    assert(new ScopedFileSystem(root), root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("ScopedFileSystem.canonicalize", { retry: 1 }, () => {
  it("rejects non-strings, absolute paths, control characters, and empty input", () => {
    withRoot((fs) => {
      expect(fs.canonicalize(undefined as unknown as string)).toBeNull();
      expect(fs.canonicalize(42 as unknown as string)).toBeNull();
      expect(fs.canonicalize("")).toBeNull();
      expect(fs.canonicalize("   ")).toBeNull();
      expect(fs.canonicalize("/etc/passwd")).toBeNull();
      expect(fs.canonicalize("\\windows\\system32")).toBeNull();
      expect(fs.canonicalize("dir/with\u0000null")).toBeNull();
      expect(fs.canonicalize("dir/with\u001fcontrol")).toBeNull();
    });
  });

  it("rejects traversal out of the root and Windows device names", () => {
    withRoot((fs) => {
      expect(fs.canonicalize("..")).toBeNull();
      expect(fs.canonicalize("../outside.txt")).toBeNull();
      expect(fs.canonicalize("a/../../outside.txt")).toBeNull();
      expect(fs.canonicalize(".")).toBeNull();
      expect(fs.canonicalize("...")).toBeNull();
      expect(fs.canonicalize("con")).toBeNull();
      expect(fs.canonicalize("dir/NUL.txt")).toBeNull();
      expect(fs.canonicalize("dir/lpt1")).toBeNull();
    });
  });

  it("normalizes the accepted shapes into the root", () => {
    withRoot((fs, root) => {
      expect(fs.canonicalize("a\\b\\c.txt")).toBe(join(root, "a", "b", "c.txt"));
      expect(fs.canonicalize("./a/./b.txt")).toBe(join(root, "a", "b.txt"));
      expect(fs.canonicalize("a/../b.txt")).toBe(join(root, "b.txt"));
      expect(fs.canonicalize("  padded.txt  ")).toBe(join(root, "padded.txt"));
    });
  });

  it("treats an illegal path as missing rather than fatal", () => {
    withRoot((fs) => {
      expect(fs.exists("../outside.txt")).toBe(false);
      expect(fs.exists("con")).toBe(false);
      expect(fs.exists("present.txt")).toBe(false);
      fs.writeFile("present.txt", "x");
      expect(fs.exists("present.txt")).toBe(true);
    });
  });
});

describe("ScopedFileSystem entry points reject an illegal path", { retry: 1 }, () => {
  it("reports missing files for read/readFileHead/edit/delete", () => {
    withRoot((fs) => {
      expect(() => fs.readFile("../outside.txt")).toThrow(WorkspaceError);
      expect(() => fs.readFile("../outside.txt")).toThrow(/file not found/);
      expect(() => fs.readFileHead("../outside.txt", 10)).toThrow(/file not found/);
      expect(() => fs.editFile("../outside.txt", "a", "b")).toThrow(/file not found/);
      expect(() => fs.deleteFile("../outside.txt")).toThrow(/file not found/);
    });
  });

  it("reports an invalid path for the write and create entry points", () => {
    withRoot((fs) => {
      expect(() => fs.writeFile("../outside.txt", "x")).toThrow(/invalid file path/);
      expect(() => fs.createFile("../outside.txt")).toThrow(/invalid file path/);
    });
  });
});

describe("ScopedFileSystem listing filters", { retry: 1 }, () => {
  it("returns nothing for an illegal base, a missing base, and a non-directory base", () => {
    withRoot((fs) => {
      expect(fs.listFiles("../outside")).toEqual([]);
      expect(fs.listFiles("missing-dir")).toEqual([]);
      fs.writeFile("file.txt", "x");
      expect(fs.listFiles("file.txt")).toEqual([]);
    });
  });

  it("walks nested directories and never follows a link entry", () => {
    withRoot((fs, root) => {
      mkdirSync(join(root, "src", "deep"), { recursive: true });
      writeFileSync(join(root, "src", "deep", "index.ts"), "", "utf-8");
      writeFileSync(join(root, "root.txt"), "", "utf-8");
      writeFileSync(join(root, ".gitkeep"), "", "utf-8");
      // A link entry would leak outside structure into the listing.
      try {
        symlinkSync(join(root, "root.txt"), join(root, "link.txt"));
      } catch {
        // Symlink creation needs a privilege on Windows; the assertion below still holds.
      }

      expect(fs.listFiles("", { recursive: true })).toEqual(["root.txt", "src/deep/index.ts"]);
      // Non-recursive lists direct child files only.
      expect(fs.listFiles("", { recursive: false })).toEqual(["root.txt"]);
      expect(fs.listFiles("src", { recursive: true })).toEqual(["src/deep/index.ts"]);
    });
  });

  it("hides the workspace placeholder from listings and the file tree", () => {
    withRoot((fs) => {
      fs.writeFile(".gitkeep", "");
      expect(fs.listFiles("", { recursive: true })).toEqual([]);
      expect(fs.listFiles("", { recursive: false })).toEqual([]);
      expect(fs.listFileEntries()).toEqual([]);
      expect(fs.fileTree("ws")).toBe("(empty)");
    });
  });
});
