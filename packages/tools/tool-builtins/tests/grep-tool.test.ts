/**
 * @file grep tool tests
 * @description Locks grep output format, invalid-regex and invalid-glob handling,
 * and the nested-quantifier (catastrophic backtracking) rejection screen.
 */

import { describe, expect, it } from "vitest";
import {
  grepTool,
  hasNestedQuantifier,
} from "@agentprism/tool-builtins";

import { ScopedFileSystem } from "@agentprism/environment";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The catastrophic shapes are hostile samples the screen has to refuse, and the
 * screen refuses them before any of them is ever compiled. They are kept as
 * fixture data so this file holds them as rejected inputs rather than as live
 * pattern literals that could one day be handed to `new RegExp`.
 */
function readPatternSamples(fileName: string): string[] {
  const text = fs.readFileSync(new URL(`./fixtures/${fileName}`, import.meta.url), "utf8");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

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

  it("treats '.' as the workspace root", async () => {
    const ws = tempWorkspace();
    try {
      ws.fs.writeFile("root.txt", "needle here\n");
      // "." must normalize to the workspace root, not to an unlistable directory that
      // reports a false "no matches" verdict.
      const outcome = await grepTool.execute(ws, { pattern: "needle", path: "." });
      expect(outcome.ok).toBe(true);
      expect(outcome.result).toContain("root.txt:1:");
    } finally {
      ws.cleanup();
    }
  });

  it("normalizes base-path spellings and matches a base-relative include glob", async () => {
    const ws = tempWorkspace();
    try {
      ws.fs.writeFile("sub/a.py", "beta\n");
      ws.fs.writeFile("sub/nested/b.py", "beta\n");
      // "./sub" is a valid spelling of the same base; it must not search nothing.
      const dotted = await grepTool.execute(ws, { pattern: "beta", path: "./sub" });
      expect(dotted.ok).toBe(true);
      expect(dotted.result).toContain("sub/a.py:1:");
      expect(dotted.result).toContain("sub/nested/b.py:1:");
      // listFiles paths are root-relative; a separator include written relative to the
      // base ("nested/*.py" under path "sub") must be tested base-stripped too, or grep
      // disagrees with the glob tool on the same pattern/base pair.
      const nested = await grepTool.execute(ws, { pattern: "beta", path: "sub", glob: "nested/*.py" });
      expect(nested.result).toBe("sub/nested/b.py:1: beta");
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

describe("grep nested-quantifier screen", () => {
  const catastrophicPatterns = readPatternSamples("catastrophic-nested-quantifier-patterns.txt");

  it.each(catastrophicPatterns)("rejects the catastrophic shape %s", (pattern) => {
    expect(hasNestedQuantifier(pattern)).toBe(true);
  });

  it("answers a nested-quantifier pattern as a tool error before any search", async () => {
    const ws = tempWorkspace();
    try {
      ws.fs.writeFile("a.py", `${"a".repeat(40)}b\n`);
      const outcome = await grepTool.execute(ws, { pattern: catastrophicPatterns[0] });
      expect(outcome.ok).toBe(false);
      expect(outcome.result).toMatch(/nested quantifier/);
    } finally {
      ws.cleanup();
    }
  });

  it.each([
    "hello",
    "a+b+",
    "a+b",
    "[a+]+",
    "(?:\\d{1,3}\\.){3}\\d{1,3}",
    "^\\d{4}-\\d{2}-\\d{2}$",
    "colou?r",
    "(ab)+c",
    "((a?)b)*c",
    "a{2,4}b",
  ])("keeps the legitimate pattern %s searchable", async (pattern) => {
    expect(hasNestedQuantifier(pattern)).toBe(false);
    const ws = tempWorkspace();
    try {
      ws.fs.writeFile("a.py", "color 192.168.1.1 2024-01-02 ababab\n");
      const outcome = await grepTool.execute(ws, { pattern });
      expect(outcome.ok).toBe(true);
    } finally {
      ws.cleanup();
    }
  });
});

