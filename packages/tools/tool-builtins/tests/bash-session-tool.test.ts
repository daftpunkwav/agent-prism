/**
 * @file bash_session tool tests
 * @description Locks persistent state, sentinel framing, and fail-closed paths.
 *
 * Responsibilities:
 * - Pin session lifecycle: start/exec/stop with per-call state
 * - Pin the sandbox-hint refusal and sentinel/timeout edge handling
 * - Pin the mid-send abort contract: AbortError out, shell stays alive
 */

import { describe, expect, it } from "vitest";
import { ScopedFileSystem } from "@agentprism/environment";
import { bashSessionTool } from "@agentprism/tool-builtins";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { removeWorkspace } from "./remove-workspace.js";

const POSIX = process.platform !== "win32";

function tempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-bashsess-"));
  return {
    name: "ws",
    root,
    cwd: () => root,
    fs: new ScopedFileSystem(root),
    cleanup: () => removeWorkspace(root),
  };
}

describe.runIf(POSIX)("bashSessionTool", () => {
  it("starts once, keeps cd/export across sends, reports exit codes", async () => {
    const ws = tempWorkspace();
    try {
      expect((await bashSessionTool.execute(ws, { action: "start" })).ok).toBe(true);
      const again = await bashSessionTool.execute(ws, { action: "start" });
      expect(again.ok).toBe(true);
      expect(again.result).toContain("already running");

      const setup = await bashSessionTool.execute(ws, { action: "send", command: "export AP_X=42 && mkdir -p sub && cd sub" });
      expect(setup.ok).toBe(true);
      expect(setup.result).toContain("[exit 0]");

      const probe = await bashSessionTool.execute(ws, { action: "send", command: "echo $AP_X:$(basename $PWD)" });
      expect(probe.ok).toBe(true);
      expect(probe.result).toContain("42:sub");
      expect(probe.result).toContain("[exit 0]");

      // Subshell exit: non-zero status framed while the session itself survives
      // (a bare `exit 3` would terminate the shell under test — correctly — so it is not used here).
      const failing = await bashSessionTool.execute(ws, { action: "send", command: "(exit 3)" });
      expect(failing.ok).toBe(true);
      expect(failing.result).toContain("[exit 3]");

      // The shell survives a failed command: state and framing still work.
      const after = await bashSessionTool.execute(ws, { action: "send", command: "echo alive" });
      expect(after.result).toContain("alive");
      expect(after.result).toContain("[exit 0]");

      const closed = await bashSessionTool.execute(ws, { action: "close" });
      expect(closed.ok).toBe(true);
      const gone = await bashSessionTool.execute(ws, { action: "send", command: "echo x" });
      expect(gone.ok).toBe(false);
    } finally {
      await bashSessionTool.execute(ws, { action: "close" }).catch(() => {});
      ws.cleanup();
    }
  });

  it("rejects bad input fail-closed", async () => {
    const ws = tempWorkspace();
    try {
      for (const bad of [{}, { action: "fly" }, { action: "send", command: "  " }, { action: "send" }]) {
        const out = await bashSessionTool.execute(ws, bad as Record<string, unknown>);
        expect(out.ok).toBe(false);
        expect(out.code).toBe("workspace_error");
      }
    } finally {
      ws.cleanup();
    }
  });

  it("aborts a mid-send wait with AbortError and keeps the shell alive", async () => {
    const ws = tempWorkspace();
    try {
      expect((await bashSessionTool.execute(ws, { action: "start" })).ok).toBe(true);
      const controller = new AbortController();
      controller.abort();
      // Pre-aborted signal: the send must stop waiting for the sentinel
      // instead of burning its full deadline in poll sleeps.
      await expect(
        bashSessionTool.execute(ws, { action: "send", command: "sleep 2" }, controller.signal),
      ).rejects.toMatchObject({ name: "AbortError" });
      // The shell survives the abort and still frames the next command.
      const after = await bashSessionTool.execute(ws, { action: "send", command: "echo alive" });
      expect(after.ok).toBe(true);
      expect(after.result).toContain("alive");
      expect(after.result).toContain("[exit 0]");
    } finally {
      await bashSessionTool.execute(ws, { action: "close" }).catch(() => {});
      ws.cleanup();
    }
  });
});

describe("bashSessionTool sandbox guard", () => {
  it("refuses to start a shell when the workspace carries an OS sandbox hint", async () => {
    const ws = tempWorkspace();
    try {
      const sandboxed = { ...ws, sandbox: { writableRoots: [ws.root] } } as typeof ws & {
        sandbox: { writableRoots: string[] };
      };
      const out = await bashSessionTool.execute(sandboxed, { action: "start" });
      expect(out.ok).toBe(false);
      expect(out.code).toBe("workspace_error");
      expect(out.result).toContain("sandbox_mode=os");
    } finally {
      ws.cleanup();
    }
  });
});
