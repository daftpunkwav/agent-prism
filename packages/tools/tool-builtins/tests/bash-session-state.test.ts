/**
 * @file bash-session tool tests
 * @description Drives the persistent-shell tool's full state machine over a fake shell.
 *
 * Responsibilities:
 * - Pin start/send/close dispatch, sandbox refusal, and dead-shell replacement
 * - Pin sentinel framing: exit-code capture, cursor advance across sends,
 *   timeout bleed-through, and mid-command shell exit
 *
 * The environment module is mocked (only spawnPersistentShell): the tool's
 * POSIX shell backend is unreachable on Windows builders, and a scripted fake
 * exercises the framing state machine deterministically without any process.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScopedFileSystem } from "@agentprism/environment";
import { spawnPersistentShell, WorkspaceError } from "@agentprism/environment";
import type { PersistentShell } from "@agentprism/environment";
import type { ToolSandboxHint } from "@agentprism/contracts";
import { bashSessionTool } from "@agentprism/tool-builtins";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { removeWorkspace } from "./remove-workspace.js";

vi.mock("@agentprism/environment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agentprism/environment")>();
  return { ...actual, spawnPersistentShell: vi.fn() };
});

const mockSpawn = vi.mocked(spawnPersistentShell);

/** Scripted PersistentShell: append predefined output on write, optional death. */
class FakeShell implements PersistentShell {
  pid = 4242;
  running = true;
  written: string[] = [];
  private buffer = "";
  /** Appended to the output buffer whenever a command is written. */
  emit: (command: string) => string = () => "";

  alive(): boolean {
    return this.running;
  }
  write(data: string): void {
    this.written.push(data);
    this.buffer += this.emit(data);
  }
  output(): string {
    return this.buffer;
  }
  kill(): void {
    this.running = false;
  }
}

function tempWorkspace(sandbox?: ToolSandboxHint) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-bash-"));
  return {
    name: "ws",
    root,
    cwd: () => root,
    fs: new ScopedFileSystem(root),
    cleanup: () => removeWorkspace(root),
    sandbox,
  };
}

describe("bash_session tool", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("rejects unknown actions and empty commands", async () => {
    const ws = tempWorkspace();
    try {
      const bad = await bashSessionTool.execute(ws, { action: "reboot" });
      expect(bad.ok).toBe(false);
      expect(bad.result).toContain("action must be one of start, send, close");
      // send/close without a live shell errors before command validation.
      const dead = await bashSessionTool.execute(ws, { action: "send", command: "" });
      expect(dead.ok).toBe(false);
      expect(dead.result).toContain("no live shell");
    } finally {
      ws.cleanup();
    }
  });

  it("refuses to start under the OS sandbox regardless of platform", async () => {
    const ws = tempWorkspace({ writableRoots: ["/tmp"] });
    try {
      const out = await bashSessionTool.execute(ws, { action: "start" });
      expect(out.ok).toBe(false);
      expect(out.result).toContain("bash_session cannot enforce the OS write sandbox");
      expect(mockSpawn).not.toHaveBeenCalled();
    } finally {
      ws.cleanup();
    }
  });

  it("starts a shell and reports its pid", async () => {
    const ws = tempWorkspace();
    try {
      const shell = new FakeShell();
      mockSpawn.mockReturnValue(shell);
      const out = await bashSessionTool.execute(ws, { action: "start" });
      expect(out.ok).toBe(true);
      expect(out.result).toContain("pid 4242");
      expect(mockSpawn).toHaveBeenCalledWith(expect.objectContaining({ cwd: ws.cwd() }));
    } finally {
      ws.cleanup();
    }
  });

  it("answers a second start with the already-running hint and replaces a dead shell", async () => {
    const ws = tempWorkspace();
    try {
      const shell = new FakeShell();
      mockSpawn.mockReturnValue(shell);
      expect((await bashSessionTool.execute(ws, { action: "start" })).ok).toBe(true);
      const again = await bashSessionTool.execute(ws, { action: "start" });
      expect(again.result).toContain("Shell already running");

      // A dead shell record is dropped and a fresh one starts.
      shell.running = false;
      const replacement = new FakeShell();
      mockSpawn.mockReturnValue(replacement);
      const restarted = await bashSessionTool.execute(ws, { action: "start" });
      expect(restarted.ok).toBe(true);
      expect(mockSpawn).toHaveBeenCalledTimes(2);
    } finally {
      ws.cleanup();
    }
  });

  it("frames a command with its sentinel: output, exit code, and cursor advance", async () => {
    const ws = tempWorkspace();
    try {
      const shell = new FakeShell();
      // Writing command N appends its body plus the matching sentinel line.
      shell.emit = (data) => {
        if (data.includes("hello")) return "hello world\n__AP_DONE_1__:0\n";
        return "second output\n__AP_DONE_2__:3\n";
      };
      mockSpawn.mockReturnValue(shell);
      await bashSessionTool.execute(ws, { action: "start" });

      const first = await bashSessionTool.execute(ws, { action: "send", command: "echo hello" });
      expect(first.ok).toBe(true);
      expect(first.result).toBe("hello world\n[exit 0]");

      // The second send only sees output after the first sentinel (cursor moved).
      const second = await bashSessionTool.execute(ws, { action: "send", command: "echo two" });
      expect(second.result).toBe("second output\n[exit 3]");
    } finally {
      ws.cleanup();
    }
  });

  it("keeps the shell alive on timeout and documents the bleed-through", async () => {
    const ws = tempWorkspace();
    try {
      const shell = new FakeShell();
      // Output arrives but no sentinel: the send waits out its budget.
      shell.emit = () => "partial output\n";
      mockSpawn.mockReturnValue(shell);
      await bashSessionTool.execute(ws, { action: "start" });
      const out = await bashSessionTool.execute(ws, { action: "send", command: "sleep 999", timeout: 1 });
      expect(out.ok).toBe(true);
      expect(out.result).toContain("Still running after 1s (shell stays alive)");
      expect(out.result).toContain("partial output");
      expect(out.result).toContain("bleed-through");
      expect(shell.running).toBe(true);
    } finally {
      ws.cleanup();
    }
  });

  it("reports partial output when the shell exits mid-command", async () => {
    const ws = tempWorkspace();
    try {
      const shell = new FakeShell();
      shell.emit = () => {
        shell.running = false;
        return "dying words\n";
      };
      mockSpawn.mockReturnValue(shell);
      await bashSessionTool.execute(ws, { action: "start" });
      const out = await bashSessionTool.execute(ws, { action: "send", command: "boom" });
      expect(out.ok).toBe(true);
      expect(out.result).toContain("Shell exited while the command ran");
      expect(out.result).toContain("dying words");
      // The dead record is dropped: the next send reports no live shell.
      const after = await bashSessionTool.execute(ws, { action: "send", command: "again" });
      expect(after.result).toContain("no live shell");
    } finally {
      ws.cleanup();
    }
  });

  it("closes the shell on demand", async () => {
    const ws = tempWorkspace();
    try {
      const shell = new FakeShell();
      mockSpawn.mockReturnValue(shell);
      await bashSessionTool.execute(ws, { action: "start" });
      const out = await bashSessionTool.execute(ws, { action: "close" });
      expect(out.result).toBe("Shell closed");
      expect(shell.running).toBe(false);
      const send = await bashSessionTool.execute(ws, { action: "send", command: "x" });
      expect(send.result).toContain("no live shell");
    } finally {
      ws.cleanup();
    }
  });

  it("maps spawn failure (bash missing) to a tool error result", async () => {
    const ws = tempWorkspace();
    try {
      mockSpawn.mockImplementation(() => {
        throw new WorkspaceError("Error: persistent shell needs POSIX bash (use bash/run_job on Windows)");
      });
      const out = await bashSessionTool.execute(ws, { action: "start" });
      expect(out.ok).toBe(false);
      expect(out.result).toContain("needs POSIX bash");
    } finally {
      ws.cleanup();
    }
  });
});
