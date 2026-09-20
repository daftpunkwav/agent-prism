/**
 * @file read tool tests
 * @description Locks file reading: full content, offset/limit slicing, missing-file errors.
 */

import { describe, expect, it } from "vitest";
import { ScopedFileSystem } from "@agentprism/environment";
import { readTool } from "@agentprism/tool-builtins";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function tempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-read-"));
  return {
    name: "ws",
    root,
    cwd: () => root,
    fs: new ScopedFileSystem(root),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

describe("readTool", () => {
  it("reads full file content", async () => {
    const ws = tempWorkspace();
    try {
      ws.fs.writeFile("a.txt", "line1\nline2");
      const out = await readTool.execute(ws, { path: "a.txt" });
      expect(out.ok).toBe(true);
      expect(out.result).toBe("line1\nline2");
    } finally {
      ws.cleanup();
    }
  });

  it("slices with 1-based offset and limit", async () => {
    const ws = tempWorkspace();
    try {
      ws.fs.writeFile("a.txt", "one\ntwo\nthree");
      const out = await readTool.execute(ws, { path: "a.txt", offset: 2, limit: 1 });
      expect(out.ok).toBe(true);
      expect(out.result).toBe("two");
    } finally {
      ws.cleanup();
    }
  });

  it("reports a missing file as a tool error, not a throw", async () => {
    const ws = tempWorkspace();
    try {
      const out = await readTool.execute(ws, { path: "missing.txt" });
      expect(out.ok).toBe(false);
      expect(out.code).toBe("workspace_error");
    } finally {
      ws.cleanup();
    }
  });
});
