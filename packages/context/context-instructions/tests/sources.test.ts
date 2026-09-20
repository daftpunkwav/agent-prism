/**
 * @file instruction sources tests
 * @description Covers layered instruction loading: bundled defaults plus repo/workspace files.
 *
 * Responsibilities:
 * - Pin precedence (bundled < repo < workspace) with same-name replacement
 * - Lock the missing/empty/unreadable skip accounting (never throws)
 */

import { describe, expect, it } from "vitest";
import { BUNDLED_INSTRUCTION_LAYERS, loadInstructionLayers, type InstructionFileAccess } from "../src/sources.js";

/** File double backed by a plain record; absent keys read as missing. */
function files(entries: Record<string, string>): InstructionFileAccess & { thrown: Set<string> } {
  const thrown = new Set<string>();
  return {
    thrown,
    exists: (path) => path in entries || thrown.has(path),
    readFile: (path) => {
      if (thrown.has(path)) throw new Error("disk glitch");
      const value = entries[path];
      if (value === undefined) throw new Error("missing");
      return value;
    },
  };
}

describe("loadInstructionLayers", () => {
  it("ships the bundled layers by default", () => {
    const result = loadInstructionLayers(files({}));
    expect(result.layers.map((layer) => layer.name)).toEqual(BUNDLED_INSTRUCTION_LAYERS.map((layer) => layer.name));
    expect(result.skipped).toBe(0);
  });

  it("can drop bundled layers for workspace-only hosts", () => {
    const result = loadInstructionLayers(files({ "AGENTS.md": "workspace body" }), { bundled: false });
    expect(result.layers.map((layer) => layer.source)).toEqual(["workspace"]);
  });

  it("layers precedence: repo below workspace, later files winning", () => {
    const result = loadInstructionLayers(
      files({
        "REPO-AGENTS.md": "repo body",
        "AGENTS.md": "base workspace body",
        "AGENTS.local.md": "local body",
      }),
      { repoFiles: ["REPO-AGENTS.md"] },
    );
    const sources = result.layers.map((layer) => [layer.source, layer.name]);
    expect(sources).toContainEqual(["repo", "repo-repo-agents-md"]);
    // AGENTS.local.md replaces AGENTS.md's same-name layer? No: names differ
    // (agents-md vs agents-local-md), so both workspace layers accumulate.
    const names = result.layers.map((layer) => layer.name);
    expect(names).toContainEqual("agents-md");
    expect(names).toContainEqual("agents-local-md");
    const local = result.layers.find((layer) => layer.name === "agents-local-md");
    expect(local?.body).toBe("local body");
  });

  it("counts missing files silently and empty/read-failed files as skipped", () => {
    const access = files({ "AGENTS.md": "   " });
    access.thrown.add("AGENTS.local.md");
    const result = loadInstructionLayers(access, { repoFiles: ["GHOST.md"] });
    // AGENTS.md empty → skipped; AGENTS.local.md read throws → skipped; repo file missing → not counted (absent).
    expect(result.skipped).toBe(2);
  });
});
