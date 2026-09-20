/**
 * @file edit tool tests
 * @description Locks substring replacement: first occurrence, cap refusal, missing-file errors.
 */

import { describe, expect, it } from "vitest";
import { ScopedFileSystem } from "@agentprism/environment";
import { MAX_FILE } from "../src/definitions/caps.js";
import { editTool } from "@agentprism/tool-builtins";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function tempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-edit-"));
  return {
    name: "ws",
    root,
    cwd: () => root,
    fs: new ScopedFileSystem(root),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

describe("editTool", () => {
  it("replaces the first occurrence and reports the diff", async () => {
    const ws = tempWorkspace();
    try {
      ws.fs.writeFile("a.txt", "hello hello");
      const out = await editTool.execute(ws, { path: "a.txt", old_text: "hello", new_text: "hi" });
      expect(out.ok).toBe(true);
      expect(out.fileDiff).toBe("Edited a.txt");
      expect(ws.fs.readFile("a.txt")).toBe("hi hello");
    } finally {
      ws.cleanup();
    }
  });

  it("refuses over-cap replacements instead of truncating", async () => {
    const ws = tempWorkspace();
    try {
      ws.fs.writeFile("a.txt", "hello");
      const out = await editTool.execute(ws, {
        path: "a.txt",
        old_text: "hello",
        new_text: "x".repeat(MAX_FILE + 1),
      });
      expect(out.ok).toBe(false);
      expect(out.result).toContain("exceeding");
      expect(ws.fs.readFile("a.txt")).toBe("hello");
    } finally {
      ws.cleanup();
    }
  });

  it("reports a missing file as a tool error, not a throw", async () => {
    const ws = tempWorkspace();
    try {
      const out = await editTool.execute(ws, { path: "missing.txt", old_text: "a", new_text: "b" });
      expect(out.ok).toBe(false);
      expect(out.code).toBe("workspace_error");
    } finally {
      ws.cleanup();
    }
  });
});
