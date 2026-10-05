/**
 * @file glob tool tests
 * @description Locks glob matching: nested patterns, stability, brace alternation, wildcard-run guard.
 */

import { describe, expect, it } from "vitest";
import {
  GLOB_MAX_UNBOUNDED_GROUPS,
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

  it("collapses adjacent wildcard runs without changing what matches", () => {
    // `****`, `**/**`, and `**` are equivalent; the compiled regex must carry a
    // single unbounded group either way so backtracking stays linear.
    const forms = ["**", "****", "**/**", "**/**/**"];
    for (const form of forms) {
      const regex = globToRegExp(`${form}.ts`);
      expect(regex.test("a.ts"), form).toBe(true);
      expect(regex.test("x/y/a.ts"), form).toBe(true);
      expect(regex.source.match(/\.\*/g)?.length ?? 0, form).toBe(1);
    }
  });

  it("rejects patterns with more wildcard runs than the fail-closed cap", () => {
    // Three separated `**` groups stay legal and still match.
    expect(globToRegExp("**/a/**/b/**/*.ts").test("x/a/y/b/z/w.ts")).toBe(true);
    const pattern = ["**", "a", "**", "b", "**", "c", "**", "d.ts"].join("");
    expect(() => globToRegExp(pattern)).toThrow(RangeError);
    expect(() => globToRegExp(pattern)).toThrow(/too complex/);
    expect(GLOB_MAX_UNBOUNDED_GROUPS).toBe(3);
  });

  it("rejects overlapping single-star runs in one segment", () => {
    // Each `a*` compiles to a separator-bounded run, but adjacent runs overlap
    // on the literal `a`, so the backtrack tree still grows combinatorially.
    expect(() => globToRegExp(`${"a*".repeat(24)}z`)).toThrow(RangeError);
    // Single stars separated by literal slashes are disjoint per segment: legal.
    expect(globToRegExp("*/*/*/*/*/*.ts").test("a/b/c/d/e/f.ts")).toBe(true);
  });

  it("compounds overlap charges across segments", () => {
    // Each segment is within the per-segment cap, but a failed match multiplies
    // every run's split count, so the cumulative overlap charges must cap too.
    expect(() => globToRegExp(`${"a*a*a*a*/".repeat(4)}z`)).toThrow(RangeError);
    // Runs of one group per segment add no ambiguity: still legal.
    expect(globToRegExp("a*/b*/c*/d*/e*/f.ts").test("a1/b2/c3/d4/e5/f.ts")).toBe(true);
  });

  it("surfaces the complexity cap as a tool error, not a thrown exception", async () => {
    const ws = tempWorkspace();
    try {
      const pattern = "**/a/**/b/**/c/**/d.ts";
      const outcome = await globTool.execute(ws, { pattern });
      expect(outcome.ok).toBe(false);
      expect(outcome.code).toBe("workspace_error");
      expect(outcome.result).toContain("too complex");
    } finally {
      ws.cleanup();
    }
  });
});
