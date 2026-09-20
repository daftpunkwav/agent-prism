/**
 * @file plan tool tests
 * @description Locks plan propose/read/clear with heading validation.
 */

import { describe, expect, it } from "vitest";
import { ScopedFileSystem } from "@agentprism/environment";
import { planTool, PLAN_STORE_FILE } from "@agentprism/tool-builtins";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function tempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-plan-"));
  return {
    name: "ws",
    root,
    cwd: () => root,
    fs: new ScopedFileSystem(root),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

describe("planTool", () => {
  it("reads empty before anything is proposed and clears idempotently", async () => {
    const ws = tempWorkspace();
    try {
      expect((await planTool.execute(ws, { action: "read" })).result).toBe("(no plan recorded)");
      expect((await planTool.execute(ws, { action: "clear" })).result).toBe("(plan cleared)");
      expect(ws.fs.exists(PLAN_STORE_FILE)).toBe(false);
    } finally {
      ws.cleanup();
    }
  });

  it("proposes, persists, and reads back a headed plan", async () => {
    const ws = tempWorkspace();
    try {
      const body = "# Migrate auth\n\n1. Add middleware\n2. Flip flag";
      const out = await planTool.execute(ws, { action: "propose", plan: body });
      expect(out.ok).toBe(true);
      expect(out.result).toContain('"Migrate auth"');
      expect(out.result).toContain("no human reviewer");
      const read = await planTool.execute(ws, { action: "read" });
      expect(read.result).toContain("Flip flag");
      expect(ws.fs.exists(PLAN_STORE_FILE)).toBe(true);
    } finally {
      ws.cleanup();
    }
  });

  it("rejects headingless, oversized, and malformed proposals fail-closed", async () => {
    const ws = tempWorkspace();
    try {
      for (const bad of [
        {},
        { action: "fly" },
        { action: "propose" },
        { action: "propose", plan: "  " },
        { action: "propose", plan: "no heading here, just prose" },
        { action: "propose", plan: `# ok\n${"x".repeat(9000)}` },
      ]) {
        const out = await planTool.execute(ws, bad as Record<string, unknown>);
        expect(out.ok).toBe(false);
        expect(out.code).toBe("workspace_error");
      }
      expect(ws.fs.exists(PLAN_STORE_FILE)).toBe(false);
    } finally {
      ws.cleanup();
    }
  });
});
