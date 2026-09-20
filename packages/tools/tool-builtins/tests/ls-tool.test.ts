/**
 * @file ls tool tests
 * @description Locks directory listing: entries, empty marker, recursive tree.
 */

import { describe, expect, it } from "vitest";
import { ScopedFileSystem } from "@agentprism/environment";
import { lsTool } from "@agentprism/tool-builtins";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function tempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-ls-"));
  return {
    name: "ws",
    root,
    cwd: () => root,
    fs: new ScopedFileSystem(root),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

describe("lsTool", () => {
  it("marks empty directories", async () => {
    const ws = tempWorkspace();
    try {
      const out = await lsTool.execute(ws, { path: "" });
      expect(out.ok).toBe(true);
      expect(out.result).toBe("(empty)");
    } finally {
      ws.cleanup();
    }
  });

  it("lists entries of a directory", async () => {
    const ws = tempWorkspace();
    try {
      ws.fs.writeFile("b.txt", "b");
      ws.fs.writeFile("sub/a.txt", "a");
      const out = await lsTool.execute(ws, { path: "sub" });
      expect(out.ok).toBe(true);
      expect(out.result).toContain("a.txt");
    } finally {
      ws.cleanup();
    }
  });

  it("renders the recursive workspace tree", async () => {
    const ws = tempWorkspace();
    try {
      ws.fs.writeFile("sub/a.txt", "a");
      const out = await lsTool.execute(ws, { path: "", recursive: true });
      expect(out.ok).toBe(true);
      expect(out.result).toContain("a.txt");
    } finally {
      ws.cleanup();
    }
  });
});
