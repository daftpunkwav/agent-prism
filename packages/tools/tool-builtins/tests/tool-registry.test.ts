/**
 * @file ToolRegistry tests
 * @description Covers register/select/execute fail-closed paths.
 *
 * Responsibilities:
 * - Exercise mutating-tool afterExecute hooks used for RAG invalidation
 */

import { describe, expect, it, vi } from "vitest";
import { createBuiltinToolRegistry } from "@agentprism/tool-builtins";
import { MapToolRegistry, selectToolRegistry } from "@agentprism/tool-registry";
import { ScopedFileSystem } from "@agentprism/environment";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function tempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-tools-"));
  return {
    name: "ws",
    root,
    cwd: () => root,
    fs: new ScopedFileSystem(root),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

describe("ToolRegistry", () => {
  it("registers builtins and selects by toolset", () => {
    const full = createBuiltinToolRegistry();
    expect([...full.authorizedNames()].sort()).toEqual(["apply_patch", "ask_user", "bash_session", "edit", "glob", "goal", "grep", "ls", "plan", "ralph_loop", "read", "run", "run_job", "scatter", "session_query", "skill", "subagent", "symbols", "todo_write", "web_search", "webfetch", "write"]);
    const readOnly = selectToolRegistry(full, "read_only");
    expect([...readOnly.authorizedNames()].sort()).toEqual(["glob", "grep", "ls", "ralph_loop", "read", "scatter", "session_query", "skill", "subagent", "symbols"]);
  });

  it("fails closed on unknown and unauthorized tools", async () => {
    const workspace = tempWorkspace();
    try {
      const registry = createBuiltinToolRegistry();
      const unknown = await registry.execute(workspace, "nope", {});
      expect(unknown.ok).toBe(false);
      expect(unknown.code).toBe("unknown_tool");

      const readOnlyNames = new Set(selectToolRegistry(registry, "read_only").authorizedNames());
      const unauthorized = await registry.execute(workspace, "write", { path: "a.txt", content: "x" }, {
        authorizedNames: readOnlyNames,
      });
      expect(unauthorized.ok).toBe(false);
      expect(unauthorized.code).toBe("unauthorized_tool");
      expect(workspace.fs.exists("a.txt")).toBe(false);
    } finally {
      workspace.cleanup();
    }
  });

  it("writes via execute and fires afterExecute for mutating tools", async () => {
    const workspace = tempWorkspace();
    try {
      const registry = createBuiltinToolRegistry();
      const after = vi.fn();
      const outcome = await registry.execute(
        workspace,
        "write",
        { path: "note.txt", content: "hello" },
        { afterExecute: after },
      );
      expect(outcome.ok).toBe(true);
      expect(workspace.fs.readFile("note.txt")).toBe("hello");
      expect(after).toHaveBeenCalledOnce();
      expect(after.mock.calls[0]?.[0]).toBe("write");
    } finally {
      workspace.cleanup();
    }
  });

  it("rejects empty tool names on register", () => {
    const registry = new MapToolRegistry();
    expect(() =>
      registry.register({
        name: "",
        description: "x",
        jsonSchema: {},
        mutatesWorkspace: false,
        execute: async () => ({ result: "", fileDiff: null, ok: true }),
      }),
    ).toThrow(/non-empty/);
  });

  it("rethrows AbortError from execute when signal is aborted", async () => {
    const workspace = tempWorkspace();
    try {
      const registry = createBuiltinToolRegistry();
      const signal = AbortSignal.abort();
      await expect(registry.execute(workspace, "read", { path: "x" }, { signal })).rejects.toMatchObject({
        name: "AbortError",
      });
    } finally {
      workspace.cleanup();
    }
  });
});

describe("ToolRegistry declarative timeout (timeout-policy parity)", () => {
  it("rejects non-positive timeoutMs on register", () => {
    const registry = new MapToolRegistry();
    expect(() =>
      registry.register({
        name: "bad",
        description: "x",
        jsonSchema: {},
        mutatesWorkspace: false,
        timeoutMs: 0,
        execute: async () => ({ result: "", fileDiff: null, ok: true }),
      }),
    ).toThrow(/timeoutMs/);
  });

  it("delegates budgeted fast tools with a derived signal and keeps the result", async () => {
    const workspace = tempWorkspace();
    try {
      const registry = new MapToolRegistry();
      let seen: AbortSignal | undefined;
      registry.register({
        name: "fast",
        description: "x",
        jsonSchema: {},
        mutatesWorkspace: false,
        timeoutMs: 10_000,
        execute: async (_w, _a, signal) => {
          seen = signal;
          return { result: "ok", fileDiff: null, ok: true };
        },
      });
      const upstream = new AbortController().signal;
      const outcome = await registry.execute(workspace, "fast", {}, { signal: upstream });
      expect(outcome).toEqual({ result: "ok", fileDiff: null, ok: true });
      expect(seen).toBeDefined();
      expect(seen).not.toBe(upstream);
    } finally {
      workspace.cleanup();
    }
  });

  it("replaces a cooperative slow tool result with code timeout", async () => {
    const workspace = tempWorkspace();
    try {
      const registry = new MapToolRegistry();
      registry.register({
        name: "slow",
        description: "x",
        jsonSchema: {},
        mutatesWorkspace: false,
        timeoutMs: 20,
        execute: (_w, _a, signal) =>
          new Promise((resolve) => {
            if (signal?.aborted) {
              resolve({ result: "stopped", fileDiff: null, ok: true });
              return;
            }
            signal?.addEventListener("abort", () => {
              resolve({ result: "stopped", fileDiff: null, ok: true });
            });
          }),
      });
      const outcome = await registry.execute(workspace, "slow", {});
      expect(outcome.ok).toBe(false);
      expect(outcome.code).toBe("timeout");
      expect(outcome.result).toMatch(/timed out after 20ms/);
    } finally {
      workspace.cleanup();
    }
  });

  it("maps a budgeted abort-throw to timeout, but caller abort still rethrows", async () => {
    const workspace = tempWorkspace();
    try {
      const registry = new MapToolRegistry();
      registry.register({
        name: "aborter",
        description: "x",
        jsonSchema: {},
        mutatesWorkspace: false,
        timeoutMs: 20,
        execute: (_w, _a, signal) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              const error = new Error("web fetch aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      });
      const timeoutOutcome = await registry.execute(workspace, "aborter", {});
      expect(timeoutOutcome.code).toBe("timeout");

      const caller = new AbortController();
      caller.abort();
      await expect(registry.execute(workspace, "aborter", {}, { signal: caller.signal })).rejects.toMatchObject({
        name: "AbortError",
      });
    } finally {
      workspace.cleanup();
    }
  });
});
