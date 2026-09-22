/**
 * @file bash tool tests
 * @description Locks shell execution: output capture, empty-command refusal, abort propagation.
 *
 * Responsibilities:
 * - Pin output capture, refusal, and abort semantics of the bash tool
 * - Pin the workspace sandbox hint reaching the spawn layer
 */

import { describe, expect, it } from "vitest";
import { ScopedFileSystem } from "@agentprism/environment";
import { bashTool } from "@agentprism/tool-builtins";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { removeWorkspace } from "./remove-workspace.js";

function tempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-run-"));
  return {
    name: "ws",
    root,
    cwd: () => root,
    fs: new ScopedFileSystem(root),
    cleanup: (budgetMs = 0) => removeWorkspace(root, budgetMs),
  };
}

describe("bashTool", () => {
  it("captures command output", async () => {
    const ws = tempWorkspace();
    try {
      const out = await bashTool.execute(ws, { command: "echo hello" });
      expect(out.ok).toBe(true);
      expect(out.result).toContain("hello");
    } finally {
      ws.cleanup();
    }
  });

  it("refuses empty commands as a tool error", async () => {
    const ws = tempWorkspace();
    try {
      const out = await bashTool.execute(ws, { command: "   " });
      expect(out.ok).toBe(false);
      expect(out.code).toBe("workspace_error");
    } finally {
      ws.cleanup();
    }
  });

  it("propagates an already-aborted signal as AbortError", async () => {
    const ws = tempWorkspace();
    try {
      const controller = new AbortController();
      controller.abort();
      await expect(bashTool.execute(ws, { command: "echo hi" }, controller.signal)).rejects.toMatchObject({
        name: "AbortError",
      });
    } finally {
      ws.cleanup();
    }
  });

  it("reports a tool error when the command exceeds its time budget", async () => {
    const ws = tempWorkspace();
    try {
      // The sleep must live in the direct shell child, not a grandchild: the
      // timeout kill only reaches the direct child, and a surviving grandchild
      // (e.g. node) would hold the workspace cwd long after the assertion.
      const command = process.platform === "win32" ? "Start-Sleep -Seconds 30" : "sleep 30";
      const out = await bashTool.execute(ws, { command, timeout: 1 });
      expect(out.ok).toBe(false);
      expect(out.result).toBe("Error: command timed out (1s)");
    } finally {
      // The timeout-killed child holds the workspace cwd until the OS releases
      // its handle: an extended budget absorbs that lag (default is 500ms).
      ws.cleanup(10_000);
    }
  }, 60_000);

  it.skipIf(process.platform !== "win32")("spawns under the OS sandbox when the workspace carries the hint", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-runsbx-"));
    const ws = {
      name: "ws",
      root,
      cwd: () => root,
      fs: new ScopedFileSystem(root),
      sandbox: { writableRoots: [root] },
      cleanup: () => removeWorkspace(root),
    };
    try {
      const out = await bashTool.execute(ws, { command: "[System.IO.File]::WriteAllText('.\\sbx-ok.txt', 'hi'); Get-Content .\\sbx-ok.txt" });
      expect(out.ok).toBe(true);
      expect(out.result).toContain("hi");
      expect(fs.existsSync(path.join(root, "sbx-ok.txt"))).toBe(true);
    } finally {
      ws.cleanup();
    }
  }, 120_000);
});
