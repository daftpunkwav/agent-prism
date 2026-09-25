/**
 * @file apply patch tool tests
 * @description Locks V4A patch parsing and file application: add/update/move/delete.
 */

import { describe, expect, it } from "vitest";
import {
  applyChunks,
  applyPatchTool,
  parseV4aPatch,
} from "@agentprism/tool-builtins";

import { ScopedFileSystem } from "@agentprism/environment";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function tempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-tools-ext-"));
  return {
    name: "ws",
    root,
    cwd: () => root,
    fs: new ScopedFileSystem(root),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

describe("parseV4aPatch", () => {
  it("parses add/update/delete/move sections", () => {
    const patch = [
      "*** Begin Patch",
      "*** Add File: new.txt",
      "+hello",
      "+world",
      "*** Update File: app.py",
      "*** Move to: lib/app.py",
      "@@",
      " def old():",
      "-    return 1",
      "+    return 2",
      "*** End of File",
      "*** Delete File: junk.txt",
      "*** End Patch",
    ].join("\n");
    const hunks = parseV4aPatch(patch);
    expect(hunks).toHaveLength(3);
    expect(hunks[0]).toEqual({ type: "add", path: "new.txt", contents: "hello\nworld" });
    expect(hunks[1]).toMatchObject({ type: "update", path: "app.py", movePath: "lib/app.py" });
    const update = hunks[1];
    if (update?.type !== "update") throw new Error("expected an update hunk");
    expect(update.chunks).toHaveLength(1);
    const chunk = update.chunks[0];
    if (chunk === undefined) throw new Error("expected a chunk");
    expect(chunk.oldLines).toEqual(["def old():", "    return 1"]);
    expect(chunk.newLines).toEqual(["def old():", "    return 2"]);
    expect(chunk.endOfFile).toBe(true);
    expect(hunks[2]).toEqual({ type: "delete", path: "junk.txt" });
  });

  it("rejects missing markers and invalid lines", () => {
    expect(() => parseV4aPatch("no markers")).toThrow();
    expect(() => parseV4aPatch("*** Begin Patch\nbogus line\n*** End Patch")).toThrow();
  });
});

describe("applyChunks", () => {
  it("replaces a located block and appends at end with endOfFile chunks", () => {
    const original = "a\nb\nc\n";
    const next = applyChunks(original, [
      { oldLines: ["b"], newLines: ["B1", "B2"] },
      { oldLines: [], newLines: ["tail"], endOfFile: true },
    ]);
    expect(next).toBe("a\nB1\nB2\nc\ntail");
  });

  it("throws when context cannot be located", () => {
    expect(() => applyChunks("a\nb\n", [{ oldLines: ["zzz"], newLines: [] }])).toThrow();
  });
});

describe("applyPatchTool", () => {
  it("adds, updates, moves, and deletes files in one call", async () => {
    const ws = tempWorkspace();
    try {
      ws.fs.writeFile("app.py", "def old():\n    return 1\n");
      ws.fs.writeFile("junk.txt", "bye");
      const patch = [
        "*** Begin Patch",
        "*** Add File: docs/readme.md",
        "+# docs",
        "*** Update File: app.py",
        "*** Move to: lib/app.py",
        "@@     return 1",
        "-    return 1",
        "+    return 2",
        "*** Delete File: junk.txt",
        "*** End Patch",
      ].join("\n");
      const outcome = await applyPatchTool.execute(ws, { patch });
      expect(outcome.ok).toBe(true);
      expect(ws.fs.readFile("docs/readme.md")).toBe("# docs");
      expect(ws.fs.readFile("lib/app.py")).toContain("return 2");
      expect(ws.fs.exists("app.py")).toBe(false);
      expect(ws.fs.exists("junk.txt")).toBe(false);
      expect(outcome.fileDiff).toContain("Created docs/readme.md");
    } finally {
      ws.cleanup();
    }
  });

  it("treats a same-path Move to as an in-place update, not write-then-delete", async () => {
    const ws = tempWorkspace();
    try {
      ws.fs.writeFile("app.py", "def old():\n    return 1\n");
      const patch = [
        "*** Begin Patch",
        "*** Update File: app.py",
        "*** Move to: app.py",
        "@@     return 1",
        "-    return 1",
        "+    return 2",
        "*** End Patch",
      ].join("\n");
      const outcome = await applyPatchTool.execute(ws, { patch });
      expect(outcome.ok).toBe(true);
      // The edited content must survive: a write-then-delete on the same path
      // would erase the just-updated file instead of editing in place.
      expect(ws.fs.exists("app.py")).toBe(true);
      expect(ws.fs.readFile("app.py")).toContain("return 2");
      expect(outcome.fileDiff).toContain("Edited app.py");
    } finally {
      ws.cleanup();
    }
  });

  it("reports context-not-found as a tool error, not a throw", async () => {
    const ws = tempWorkspace();
    try {
      ws.fs.writeFile("a.txt", "one\n");
      const patch = ["*** Begin Patch", "*** Update File: a.txt", "@@ missing", "-x", "+y", "*** End Patch"].join("\n");
      const outcome = await applyPatchTool.execute(ws, { patch });
      expect(outcome.ok).toBe(false);
      expect(outcome.result).toContain("not found");
    } finally {
      ws.cleanup();
    }
  });
});

