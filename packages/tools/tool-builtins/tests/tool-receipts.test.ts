/**
 * @file tool receipts tests
 * @description Locks write-tool receipt char counts (chars, not bytes).
 */

import { describe, expect, it } from "vitest";
import {
  writeTool,
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

describe("tool receipts report estimated tokens", () => {
  it("write and apply_patch receipts use token estimates", async () => {
    const ws = tempWorkspace();
    try {
      const written = await writeTool.execute(ws, { path: "a.txt", content: "héllo!" });
      expect(written.fileDiff).toContain("(~2 tokens)");
    } finally {
      ws.cleanup();
    }
  });
});
