/**
 * @file goal tool tests
 * @description Locks the session-objective lifecycle: set/get/status/clear and guards.
 */

import { describe, expect, it } from "vitest";
import { ScopedFileSystem } from "@agentprism/environment";
import { goalTool, GOAL_STORE_FILE } from "@agentprism/tool-builtins";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function tempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-goal-"));
  return {
    name: "ws",
    root,
    cwd: () => root,
    fs: new ScopedFileSystem(root),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

describe("goalTool", () => {
  it("reports no goal before one is set and clears idempotently", async () => {
    const ws = tempWorkspace();
    try {
      expect((await goalTool.execute(ws, { action: "get" })).result).toBe("(no goal set)");
      expect((await goalTool.execute(ws, { action: "clear" })).result).toBe("(goal cleared)");
      expect(ws.fs.exists(GOAL_STORE_FILE)).toBe(false);
    } finally {
      ws.cleanup();
    }
  });

  it("sets, gets, and persists the objective with criteria", async () => {
    const ws = tempWorkspace();
    try {
      const set = await goalTool.execute(ws, {
        action: "set",
        objective: "Ship the thing",
        criteria: ["tests green", "docs synced"],
      });
      expect(set.ok).toBe(true);
      expect(set.result).toContain("# Goal [active]");
      expect(set.result).toContain("Ship the thing");
      expect(set.result).toContain("- tests green");
      const get = await goalTool.execute(ws, { action: "get" });
      expect(get.result).toContain("Ship the thing");
      expect(ws.fs.exists(GOAL_STORE_FILE)).toBe(true);
    } finally {
      ws.cleanup();
    }
  });

  it("moves status and demands a reason for blocked", async () => {
    const ws = tempWorkspace();
    try {
      await goalTool.execute(ws, { action: "set", objective: "Do it" });
      const noReason = await goalTool.execute(ws, { action: "status", status: "blocked" });
      expect(noReason.ok).toBe(false);
      const blocked = await goalTool.execute(ws, { action: "status", status: "blocked", detail: "waiting on API key" });
      expect(blocked.ok).toBe(true);
      expect(blocked.result).toContain("[blocked]");
      expect(blocked.result).toContain("waiting on API key");
      const done = await goalTool.execute(ws, { action: "status", status: "completed", detail: "shipped" });
      expect(done.result).toContain("[completed]");
      const cleared = await goalTool.execute(ws, { action: "clear" });
      expect(cleared.ok).toBe(true);
      expect((await goalTool.execute(ws, { action: "get" })).result).toBe("(no goal set)");
    } finally {
      ws.cleanup();
    }
  });

  it("accepts cased action/status (model-cased tolerance)", async () => {
    const ws = tempWorkspace();
    try {
      const set = await goalTool.execute(ws, { action: "SET", objective: "Do it" });
      expect(set.ok).toBe(true);
      const done = await goalTool.execute(ws, { action: "Status", status: "COMPLETED", detail: "shipped" });
      expect(done.ok).toBe(true);
      expect(done.result).toContain("[completed]");
    } finally {
      ws.cleanup();
    }
  });

  it("rejects bad input fail-closed", async () => {
    const ws = tempWorkspace();
    try {
      for (const bad of [
        {},
        { action: "fly" },
        { action: "set" },
        { action: "set", objective: "" },
        { action: "set", objective: "x", criteria: "nope" },
        { action: "status", status: "flying" },
        { action: "status", status: "active" },
      ]) {
        const out = await goalTool.execute(ws, bad as Record<string, unknown>);
        expect(out.ok).toBe(false);
        expect(out.code).toBe("workspace_error");
      }
      expect(ws.fs.exists(GOAL_STORE_FILE)).toBe(false);
    } finally {
      ws.cleanup();
    }
  });
});
