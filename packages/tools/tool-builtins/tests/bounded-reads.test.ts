/**
 * @file bounded read tests
 * @description Locks the byte-capped head read and the tools that depend on it.
 *
 * Responsibilities:
 * - Pin readFileHead semantics (cap, truncation flag, no split-character mojibake)
 * - Pin that read reports an oversized file instead of silently prefixing it
 * - Pin that grep bounds the bytes it scans and says which files it only headed
 * - Pin that the symbol index is cached until the files change
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ScopedFileSystem } from "@agentprism/environment";
import { grepTool, readTool } from "@agentprism/tool-builtins";
import { SYMBOLS_TOOL_NAME, symbolsTool } from "@agentprism/tool-symbols";

function workspace(): { fs: ScopedFileSystem; root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "aprism-bounded-"));
  return {
    fs: new ScopedFileSystem(root),
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe("ScopedFileSystem.readFileHead", () => {
  it("returns a bounded prefix and reports the truncation", () => {
    const ws = workspace();
    try {
      ws.fs.writeFile("big.txt", "x".repeat(1000));
      const head = ws.fs.readFileHead("big.txt", 100);
      expect(head.text).toBe("x".repeat(100));
      expect(head.truncated).toBe(true);
      const whole = ws.fs.readFileHead("big.txt", 5000);
      expect(whole.truncated).toBe(false);
      expect(whole.text.length).toBe(1000);
    } finally {
      ws.cleanup();
    }
  });

  it("does not split a multi-byte character at the byte cap", () => {
    const ws = workspace();
    try {
      ws.fs.writeFile("cn.txt", "中".repeat(10));
      // 4 bytes would cut inside the second character (3 bytes each).
      const head = ws.fs.readFileHead("cn.txt", 4);
      expect(head.text).toBe("中");
      expect(head.text).not.toContain("\uFFFD");
    } finally {
      ws.cleanup();
    }
  });

  it("rejects a missing file like readFile does", () => {
    const ws = workspace();
    try {
      expect(() => ws.fs.readFileHead("nope.txt", 10)).toThrow(/not found/);
    } finally {
      ws.cleanup();
    }
  });
});

describe("read tool on an oversized file", () => {
  it("stays within its cap and tells the model the file continues", async () => {
    const ws = workspace();
    try {
      writeFileSync(join(ws.root, "huge.txt"), `${"line\n".repeat(200_000)}tail`);
      const result = await readTool.execute(ws as never, { path: "huge.txt" });
      expect(result.ok).toBe(true);
      // Loud: the model learns the content continues instead of assuming this is all.
      expect(result.result).toContain("offset/limit");
      expect(result.result.length).toBeLessThan(300_000);
    } finally {
      ws.cleanup();
    }
  });
});

describe("grep tool byte budget", () => {
  it("searches an oversized file through its head and reports that", async () => {
    const ws = workspace();
    try {
      // 3 MiB of a unique token: past the per-file head cap.
      writeFileSync(join(ws.root, "bundle.js"), `${"q".repeat(3 * 1024 * 1024)}NEEDLE`);
      const result = await grepTool.execute(ws as never, { pattern: "NEEDLE" });
      expect(result.ok).toBe(true);
      // The tail past the head cap is not searched, and the result says so.
      expect(result.result).toContain("No matches for NEEDLE");
      const headHit = await grepTool.execute(ws as never, { pattern: "qqqq" });
      expect(headHit.result).toContain("searched only in their first");
    } finally {
      ws.cleanup();
    }
  });
});

describe("symbols index cache", () => {
  it("reuses the index until a file changes", async () => {
    const ws = workspace();
    try {
      ws.fs.writeFile("a.ts", "export function alphaBeta(): number { return 1; }\n");
      const first = await symbolsTool.execute(ws as never, { action: "search", query: "alphaBeta" });
      expect(first.result).toContain("alphaBeta");
      // A second call must agree; an edit must be visible (the cache is fingerprint-keyed).
      const second = await symbolsTool.execute(ws as never, { action: "search", query: "alphaBeta" });
      expect(second.result).toBe(first.result);
      ws.fs.writeFile("b.ts", "export function gammaDelta(): number { return 2; }\n");
      const third = await symbolsTool.execute(ws as never, { action: "search", query: "gammaDelta" });
      expect(third.result).toContain("gammaDelta");
      expect(SYMBOLS_TOOL_NAME).toBe("symbols");
    } finally {
      ws.cleanup();
    }
  });
});
