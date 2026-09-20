/**
 * @file todo_write tool tests
 * @description Locks whole-list replacement, validation, and workspace persistence.
 */

import { describe, expect, it } from "vitest";
import { ScopedFileSystem } from "@agentprism/environment";
import { todoTool, TODO_STORE_FILE } from "@agentprism/tool-builtins";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function tempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-todo-"));
  return {
    name: "ws",
    root,
    cwd: () => root,
    fs: new ScopedFileSystem(root),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

describe("todoTool", () => {
  it("writes the whole list and renders a checklist", async () => {
    const ws = tempWorkspace();
    try {
      const out = await todoTool.execute(ws, {
        todos: [
          { content: "explore repo", status: "completed" },
          { content: "write code", status: "in_progress" },
          { content: "run tests", status: "pending" },
        ],
      });
      expect(out.ok).toBe(true);
      expect(out.result).toContain("1/3 completed");
      expect(out.result).toContain("[x] explore repo");
      expect(out.result).toContain("[=] write code");
      expect(out.result).toContain("[ ] run tests");
      expect(ws.fs.exists(TODO_STORE_FILE)).toBe(true);
    } finally {
      ws.cleanup();
    }
  });

  it("replaces the previous list on every call", async () => {
    const ws = tempWorkspace();
    try {
      await todoTool.execute(ws, { todos: [{ content: "old", status: "pending" }] });
      const out = await todoTool.execute(ws, { todos: [{ content: "new", status: "completed" }] });
      expect(out.ok).toBe(true);
      expect(out.result).toContain("[x] new");
      expect(out.result).not.toContain("old");
    } finally {
      ws.cleanup();
    }
  });

  it("accepts cased statuses (model-cased tolerance)", async () => {
    const ws = tempWorkspace();
    try {
      const out = await todoTool.execute(ws, {
        todos: [
          { content: "a", status: "COMPLETED" },
          { content: "b", status: "In_Progress" },
        ],
      });
      expect(out.ok).toBe(true);
      expect(out.result).toContain("[x] a");
      expect(out.result).toContain("[=] b");
    } finally {
      ws.cleanup();
    }
  });

  it("rejects bad input fail-closed without touching storage", async () => {
    const ws = tempWorkspace();
    try {
      for (const bad of [
        {},
        { todos: "nope" },
        { todos: [{ content: "", status: "pending" }] },
        { todos: [{ content: "x", status: "flying" }] },
        { todos: [{ content: "dup", status: "pending" }, { content: "dup", status: "pending" }] },
        { todos: Array.from({ length: 51 }, (_, i) => ({ content: `t${i}`, status: "pending" })) },
      ]) {
        const out = await todoTool.execute(ws, bad as Record<string, unknown>);
        expect(out.ok).toBe(false);
        expect(out.code).toBe("workspace_error");
      }
      expect(ws.fs.exists(TODO_STORE_FILE)).toBe(false);
    } finally {
      ws.cleanup();
    }
  });

  it("heals over corrupt storage on the next write", async () => {
    const ws = tempWorkspace();
    try {
      ws.fs.writeFile(TODO_STORE_FILE, "{not json");
      const out = await todoTool.execute(ws, { todos: [{ content: "fresh", status: "pending" }] });
      expect(out.ok).toBe(true);
      expect(out.result).toContain("[ ] fresh");
    } finally {
      ws.cleanup();
    }
  });
});
