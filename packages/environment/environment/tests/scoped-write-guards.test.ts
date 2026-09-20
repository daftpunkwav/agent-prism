/**
 * @file scoped write guards tests
 * @description Locks write/edit guards: non-empty old text and char-count receipts.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ScopedFileSystem } from "@agentprism/environment";

function makeRoot(): string {
  const root = join(tmpdir(), `aprism-fs-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

describe("ScopedFileSystem write/edit guards", () => {
  it("rejects empty old_text instead of silently prepending", () => {
    const root = makeRoot();
    try {
      const fs = new ScopedFileSystem(root);
      fs.writeFile("a.txt", "hello");
      expect(() => fs.editFile("a.txt", "", "PREPENDED")).toThrow(/old_text must not be empty/);
      expect(fs.readFile("a.txt")).toBe("hello");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("write receipt reports an estimated token count (tokens, not bytes)", () => {
    const root = makeRoot();
    try {
      const fs = new ScopedFileSystem(root);
      // 6 chars at the shared 4-chars-per-token divisor estimate to 2 tokens; a bytes label would report 7.
      expect(fs.writeFile("a.txt", "héllo!")).toContain("(~2 tokens)");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
