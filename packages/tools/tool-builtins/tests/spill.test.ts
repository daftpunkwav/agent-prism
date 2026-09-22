/**
 * @file spill tests
 * @description Locks persist-then-prune: passthrough, spill shape, rotation, loud degradation.
 *
 * Responsibilities:
 * - Pin text bounding (passthrough, truncate, spill) and spill file rotation
 * - Pin loud degradation when the workspace cannot persist output
 */

import { describe, expect, it } from "vitest";
import { ScopedFileSystem } from "@agentprism/environment";
import {
  boundText,
  SPILL_DIR,
  SPILL_THRESHOLD_BYTES,
} from "@agentprism/tool-builtins";
import { bashTool } from "@agentprism/tool-builtins";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { removeWorkspace } from "./remove-workspace.js";

function tempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-spill-"));
  return {
    name: "ws",
    root,
    cwd: () => root,
    fs: new ScopedFileSystem(root),
    cleanup: () => removeWorkspace(root),
  };
}

describe("boundText", () => {
  it("passes small results through exactly like truncate", () => {
    const ws = tempWorkspace();
    try {
      expect(boundText(ws, "bash", "hello")).toBe("hello");
      expect(ws.fs.exists(SPILL_DIR)).toBe(false);
    } finally {
      ws.cleanup();
    }
  });

  it("spills oversized text and keeps a headed preview with a readable artifact", () => {
    const ws = tempWorkspace();
    try {
      const body = `line-${"x".repeat(4000)}\n`;
      const big = body.repeat(12);
      if (Buffer.byteLength(big, "utf-8") <= SPILL_THRESHOLD_BYTES) throw new Error("fixture too small");
      const out = boundText(ws, "bash", big);
      expect(out).toMatch(/^\[output spilled: \d+ chars total; full text at \.spills\/spill-000001-bash-[a-z0-9]{6}\.txt/);
      const files = ws.fs.listFiles(SPILL_DIR, { recursive: false });
      expect(files).toHaveLength(1);
      expect(ws.fs.readFile(files[0] as string)).toBe(big);
      // Preview still carries head and tail around the prune marker.
      expect(out).toContain("line-xxx");
      expect(out).toMatch(/middle pruned/);
    } finally {
      ws.cleanup();
    }
  });

  it("rotates only spill-*.txt and never run-job *.log artifacts", () => {
    const ws = tempWorkspace();
    try {
      ws.fs.writeFile(`${SPILL_DIR}/000001-job1.log`, "job log");
      for (let i = 0; i < 22; i += 1) {
        boundText(ws, "grep", `g${i}-` + "y".repeat(4000) + "\n".repeat(1) + "z".repeat(33000));
      }
      const files = ws.fs.listFiles(SPILL_DIR, { recursive: false });
      const spills = files.filter((f) => f.endsWith(".txt"));
      expect(spills).toHaveLength(20);
      expect(files.some((f) => f.endsWith("000001-job1.log"))).toBe(true);
      // Chronological eviction: the oldest spill is gone, the newest remains.
      expect(spills.some((f) => f.includes("spill-000001-"))).toBe(false);
      expect(spills.some((f) => f.includes("spill-000022-"))).toBe(true);
    } finally {
      ws.cleanup();
    }
  });

  it("degrades to loud truncation when the filesystem fails", () => {
    const broken = {
      name: "ws",
      root: "/nonexistent",
      cwd: () => "/nonexistent",
      fs: {
        writeFile: () => {
          throw new Error("disk gone");
        },
        deleteFile: () => {},
        listFiles: () => ["spill-000007-run.txt"],
      },
    };
    const out = boundText(broken, "bash", "q".repeat(SPILL_THRESHOLD_BYTES + 100));
    expect(out).toMatch(/middle pruned/);
    expect(out).toContain("(spill failed: disk gone)");
  });

  it("falls back to truncate when the workspace has no usable fs", () => {
    const bare = { name: "ws", root: "/tmp", cwd: () => "/tmp", fs: null };
    expect(boundText(bare, "bash", "ok")).toBe("ok");
  });
});

describe("bash tool spill wiring", () => {
  it("spills huge command output instead of losing the middle", async () => {
    const ws = tempWorkspace();
    try {
      // The command still runs through the platform shell (PowerShell on
      // Windows), but node emits the 20000 lines instantly — the old
      // `1..20000`/`seq` pipelines made the case measure shell pipeline speed
      // instead of spill behavior, timing out under parallel suite load.
      const command = `${process.execPath} -e "for(let i=0;i<20000;i++)console.log(i)"`;
      const out = await bashTool.execute(ws, { command, timeout: 120 });
      expect(out.ok).toBe(true);
      expect(out.result).toMatch(/\[output spilled: \d+ chars total; full text at \.spills\/spill-\d+-bash-[a-z0-9]{6}\.txt/);
      const files = ws.fs.listFiles(SPILL_DIR, { recursive: false });
      expect(files).toHaveLength(1);
      expect(ws.fs.readFile(files[0] as string)).toContain("19999");
    } finally {
      ws.cleanup();
    }
  }, 120_000);
});
