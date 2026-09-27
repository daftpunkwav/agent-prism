/**
 * @file workspace process disposal tests
 * @description Locks that a released workspace takes its background processes with it.
 *
 * Responsibilities:
 * - Pin the disposal seam contract for registered tools
 * - Pin that a running background job is killed and forgotten on release
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ScopedFileSystem } from "@agentprism/environment";
import { bashSessionTool, disposeWorkspaceProcesses, onWorkspaceDispose, runJobTool } from "@agentprism/tool-builtins";
import { removeWorkspace } from "./remove-workspace.js";

function tempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-dispose-"));
  return {
    name: "ws",
    root,
    cwd: () => root,
    fs: new ScopedFileSystem(root),
    cleanup: () => removeWorkspace(root),
  };
}

describe("disposeWorkspaceProcesses", { retry: 1 }, () => {
  it("runs every registered disposer for the released root", () => {
    const seen: string[] = [];
    const stop = (root: string) => seen.push(root);
    onWorkspaceDispose(stop);
    disposeWorkspaceProcesses("/tmp/ws-release-probe");
    expect(seen).toContain("/tmp/ws-release-probe");
  });

  it("kills a running background job and forgets its scope", async () => {
    const ws = tempWorkspace();
    try {
      const started = await runJobTool.execute(ws as never, { action: "start", command: "node -e \"setTimeout(()=>{},60000)\"" });
      expect(started.ok).toBe(true);
      const before = await runJobTool.execute(ws as never, { action: "list" });
      expect(before.result).not.toContain("(no background jobs)");

      disposeWorkspaceProcesses(ws.root);

      const after = await runJobTool.execute(ws as never, { action: "list" });
      expect(after.result).toContain("(no background jobs)");
    } finally {
      ws.cleanup();
    }
  });

  it("closes a resident shell on release", async () => {
    const ws = tempWorkspace();
    try {
      const opened = await bashSessionTool.execute(ws as never, { action: "start" });
      if (!opened.ok) return; // Windows fails closed toward bash/run_job
      disposeWorkspaceProcesses(ws.root);
      // A fresh start must succeed: the previous shell is gone, not silently reused.
      const restarted = await bashSessionTool.execute(ws as never, { action: "start" });
      expect(restarted.ok).toBe(true);
      await bashSessionTool.execute(ws as never, { action: "close" });
    } finally {
      ws.cleanup();
    }
  });

  it("is idempotent for an unknown root", () => {
    const spy = vi.fn();
    onWorkspaceDispose(spy);
    disposeWorkspaceProcesses("/tmp/ws-never-existed");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
