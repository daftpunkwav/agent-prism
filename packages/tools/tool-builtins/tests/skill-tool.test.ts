/**
 * @file skill tool tests
 * @description Locks skill discovery: bundled list, workspace override, fail-closed reads.
 */

import { describe, expect, it } from "vitest";
import { ScopedFileSystem } from "@agentprism/environment";
import { skillTool } from "@agentprism/tool-builtins";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function tempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentprism-skill-"));
  return {
    name: "ws",
    root,
    cwd: () => root,
    fs: new ScopedFileSystem(root),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

describe("skillTool", () => {
  it("lists bundled skills without any workspace setup", async () => {
    const ws = tempWorkspace();
    try {
      const out = await skillTool.execute(ws, { action: "list" });
      expect(out.ok).toBe(true);
      expect(out.result).toContain("- commit:");
      expect(out.result).toContain("- review:");
      expect(out.result).toContain("[bundled]");
    } finally {
      ws.cleanup();
    }
  });

  it("reads a bundled skill body", async () => {
    const ws = tempWorkspace();
    try {
      const out = await skillTool.execute(ws, { action: "read", name: "commit" });
      expect(out.ok).toBe(true);
      expect(out.result).toContain("Conventional Commits");
    } finally {
      ws.cleanup();
    }
  });

  it("prefers workspace skills and skips malformed ones loudly", async () => {
    const ws = tempWorkspace();
    try {
      ws.fs.writeFile(".skills/commit/SKILL.md", "---\ndescription: Team override\n---\nTeam body.");
      ws.fs.writeFile(".skills/BAD/SKILL.md", "nope");
      ws.fs.writeFile(".skills/broken/SKILL.md", "---\ndescription: x\n---\n");
      const list = await skillTool.execute(ws, { action: "list" });
      expect(list.ok).toBe(true);
      expect(list.result).toContain("[workspace]");
      expect(list.result).toContain("2 invalid workspace skill(s) skipped");
      const read = await skillTool.execute(ws, { action: "read", name: "commit" });
      expect(read.ok).toBe(true);
      expect(read.result).toContain("Team body.");
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
        { action: "read", name: "Nope" },
        { action: "read", name: "missing" },
        { action: "read" },
      ]) {
        const out = await skillTool.execute(ws, bad as Record<string, unknown>);
        expect(out.ok).toBe(false);
        expect(out.code).toBe("workspace_error");
      }
    } finally {
      ws.cleanup();
    }
  });
});
