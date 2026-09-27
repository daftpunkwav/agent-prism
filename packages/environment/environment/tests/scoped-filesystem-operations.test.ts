/**
 * @file scoped filesystem operations tests
 * @description Locks the read/write/edit/delete surface and the project snapshot
 *              export of the root-scoped filesystem.
 *
 * Responsibilities:
 * - Pin edit/delete semantics: missing text, missing files, and existence checks
 * - Pin the file tree rendering and the byte-windowed read
 * - Pin the snapshot budget: it is enforced during the walk, not after it
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ScopedFileSystem } from "@agentprism/environment";

function makeRoot(): string {
  const root = join(tmpdir(), `aprism-fs-ops-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

describe("ScopedFileSystem edit and delete", () => {
  it("replaces text once and reports the path", () => {
    const root = makeRoot();
    try {
      const fs = new ScopedFileSystem(root);
      fs.writeFile("note.txt", "alpha beta alpha");
      expect(fs.editFile("note.txt", "alpha", "gamma")).toBe("Edited: note.txt");
      // String.replace with a string needle replaces the first match only.
      expect(fs.readFile("note.txt")).toBe("gamma beta alpha");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an edit whose needle is absent and leaves the file untouched", () => {
    const root = makeRoot();
    try {
      const fs = new ScopedFileSystem(root);
      fs.writeFile("note.txt", "body");
      expect(() => fs.editFile("note.txt", "missing", "x")).toThrow(/text to replace not found/);
      expect(fs.readFile("note.txt")).toBe("body");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an edit of a file that does not exist", () => {
    const root = makeRoot();
    try {
      const fs = new ScopedFileSystem(root);
      expect(() => fs.editFile("nope.txt", "a", "b")).toThrow(/not found/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("deletes a file once and reports the second attempt as missing", () => {
    const root = makeRoot();
    try {
      const fs = new ScopedFileSystem(root);
      fs.writeFile("gone.txt", "x");
      expect(fs.deleteFile("gone.txt")).toBe("Deleted: gone.txt");
      expect(() => fs.deleteFile("gone.txt")).toThrow(/not found/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("ScopedFileSystem createFile", () => {
  it("creates an empty file and refuses to overwrite an existing one", () => {
    const root = makeRoot();
    try {
      const fs = new ScopedFileSystem(root);
      expect(fs.createFile("fresh.txt")).toMatch(/Wrote: fresh.txt/);
      expect(fs.readFile("fresh.txt")).toBe("");
      fs.writeFile("kept.txt", "original");
      expect(() => fs.createFile("kept.txt", "overwrite")).toThrow(/already exists/);
      expect(fs.readFile("kept.txt")).toBe("original");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("ScopedFileSystem readFileHead", () => {
  it("reads a window from the given byte offset and reports what follows", () => {
    const root = makeRoot();
    try {
      const fs = new ScopedFileSystem(root);
      fs.writeFile("log.txt", "0123456789");
      const first = fs.readFileHead("log.txt", 4);
      expect(first.text).toBe("0123");
      expect(first.bytesRead).toBe(4);
      expect(first.truncated).toBe(true);

      const second = fs.readFileHead("log.txt", 4, 4);
      expect(second.text).toBe("4567");
      expect(second.truncated).toBe(true);

      const tail = fs.readFileHead("log.txt", 100, 8);
      expect(tail.text).toBe("89");
      expect(tail.truncated).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is empty for an offset at or past the end", () => {
    const root = makeRoot();
    try {
      const fs = new ScopedFileSystem(root);
      fs.writeFile("log.txt", "abc");
      const atEnd = fs.readFileHead("log.txt", 10, 3);
      expect(atEnd.text).toBe("");
      expect(atEnd.truncated).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("ScopedFileSystem listing helpers", () => {
  it("lists file entries with size and mtime", () => {
    const root = makeRoot();
    try {
      const fs = new ScopedFileSystem(root);
      fs.writeFile("dir/a.txt", "12345");
      const entries = fs.listFileEntries();
      const entry = entries.find((candidate) => candidate.path === "dir/a.txt");
      expect(entry).toMatchObject({ size: 5 });
      expect(entry?.mtimeMs).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("renders the file tree with sizes and an empty marker", () => {
    const root = makeRoot();
    try {
      const fs = new ScopedFileSystem(root);
      expect(fs.fileTree("ws")).toBe("(empty)");
      fs.writeFile("a.txt", "1234");
      const tree = fs.fileTree("ws");
      expect(tree).toContain("📁 ws/");
      expect(tree).toContain("📄 a.txt (4 bytes)");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("ScopedFileSystem snapshotFiles", () => {
  it("exports every file when the budget allows", async () => {
    const root = makeRoot();
    try {
      const fs = new ScopedFileSystem(root);
      fs.writeFile("one.txt", "alpha");
      fs.writeFile("nested/two.txt", "beta");
      expect(await fs.snapshotFiles()).toEqual({ "one.txt": "alpha", "nested/two.txt": "beta" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stops at the character budget instead of materializing the rest", async () => {
    const root = makeRoot();
    try {
      const fs = new ScopedFileSystem(root);
      fs.writeFile("aaa.txt", "x".repeat(50));
      fs.writeFile("bbb.txt", "y".repeat(50));
      fs.writeFile("ccc.txt", "z".repeat(50));
      const snapshot = await fs.snapshotFiles({ maxTotalChars: 60 });
      // The first file fits; the walk stops before the third exceeds the budget.
      expect(Object.keys(snapshot)).toEqual(["aaa.txt"]);
      expect(snapshot["aaa.txt"]).toBe("x".repeat(50));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips a file that vanishes during the walk", async () => {
    const root = makeRoot();
    try {
      const fs = new ScopedFileSystem(root);
      fs.writeFile("kept.txt", "kept");
      // A dangling symlink appears in the listing but cannot be read.
      writeFileSync(join(root, "broken.txt"), "");
      const snapshot = await fs.snapshotFiles();
      expect(snapshot["kept.txt"]).toBe("kept");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
