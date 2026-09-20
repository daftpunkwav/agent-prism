/**
 * @file grep tool tests
 * @description Locks grep output format, invalid-regex and invalid-glob handling.
 */

import { describe, expect, it } from "vitest";
import {
  grepTool,
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

describe("grepTool", () => {
  it("returns path:line matches with glob filter and case folding", async () => {
    const ws = tempWorkspace();
    try {
      ws.fs.writeFile("src/a.py", "def one():\n    return Hello\n");
      ws.fs.writeFile("src/b.md", "hello there\n");
      const outcome = await grepTool.execute(ws, { pattern: "hello", glob: "*.py", case_insensitive: true });
      expect(outcome.ok).toBe(true);
      expect(outcome.result).toBe("src/a.py:2:     return Hello");
    } finally {
      ws.cleanup();
    }
  });

  it("rejects an invalid regex as a tool error", async () => {
    const ws = tempWorkspace();
    try {
      const outcome = await grepTool.execute(ws, { pattern: "([unclosed" });
      expect(outcome.ok).toBe(false);
      expect(outcome.result).toContain("invalid regular expression");
    } finally {
      ws.cleanup();
    }
  });
});

describe("grep invalid glob parity", () => {
  it("reports invalid glob patterns as tool errors instead of throwing", async () => {
    const ws = tempWorkspace();
    try {
      ws.fs.writeFile("a.py", "hello\n");
      const outcome = await grepTool.execute(ws, { pattern: "hello", glob: "[z-a]" });
      expect(outcome.ok).toBe(false);
      expect(outcome.result).toMatch(/invalid glob pattern/);
    } finally {
      ws.cleanup();
    }
  });
});

