/**
 * @file glob tool tests
 * @description Locks glob matching: nested patterns, stability, brace alternation.
 */

import { describe, expect, it } from "vitest";
import {
  globToRegExp,
  globTool,
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

describe("globTool", () => {
  it("matches nested patterns and keeps results stable", async () => {
    const ws = tempWorkspace();
    try {
      ws.fs.writeFile("src/a.ts", "1");
      ws.fs.writeFile("src/nested/b.ts", "2");
      ws.fs.writeFile("docs/c.md", "3");
      const outcome = await globTool.execute(ws, { pattern: "src/**/*.ts" });
      expect(outcome.ok).toBe(true);
      const files = outcome.result.split("\n").sort();
      expect(files).toEqual(["src/a.ts", "src/nested/b.ts"]);
    } finally {
      ws.cleanup();
    }
  });

  it("supports brace alternation", () => {
    const regex = globToRegExp("*.{ts,tsx}");
    expect(regex.test("a.ts")).toBe(true);
    expect(regex.test("b.tsx")).toBe(true);
    expect(regex.test("c.js")).toBe(false);
  });

  it("compiles the remaining glob syntax branches", () => {
    // `?` matches one non-separator char.
    const q = globToRegExp("a?c");
    expect(q.test("abc")).toBe(true);
    expect(q.test("a/c")).toBe(false);
    // Character classes pass through; an unclosed `[` stays literal.
    const cls = globToRegExp("[a-c]at");
    expect(cls.test("bat")).toBe(true);
    expect(cls.test("dat")).toBe(false);
    const literal = globToRegExp("a[b");
    expect(literal.test("a[b")).toBe(true);
    // A bare trailing `**` matches everything; `**/` matches zero or more segments.
    expect(globToRegExp("src/**").test("src/a/b.ts")).toBe(true);
    expect(globToRegExp("**/*.ts").test("a.ts")).toBe(true);
    expect(globToRegExp("**/*.ts").test("x/y/a.ts")).toBe(true);
    // Regex metacharacters in the pattern stay literal.
    expect(globToRegExp("a+b.txt").test("a+b.txt")).toBe(true);
    expect(globToRegExp("a+b.txt").test("aab.txt")).toBe(false);
    // Unclosed `{` stays literal.
    expect(globToRegExp("a{b").test("a{b")).toBe(true);
  });
});
