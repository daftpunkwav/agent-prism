/**
 * @file paths tests
 * @description Locks repo-root anchoring for all data paths.
 *
 * Responsibilities:
 * - Pin REPO_ROOT at the monorepo root and DATA_DIR beneath it
 *
 * Regression: the uniform family nesting deepened leaf depth; a stale
 * three-level climb silently relocated DATA_DIR into packages/.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DATA_DIR, PROJECTS_PATH, REPO_ROOT, RUNS_DIR, SESSIONS_PATH } from "../src/paths.js";

describe("repo-root anchoring", () => {
  it("anchors at the monorepo root (pnpm workspace file lives here)", () => {
    expect(path.basename(REPO_ROOT)).not.toBe("packages");
    expect(fs.existsSync(path.join(REPO_ROOT, "pnpm-workspace.yaml"))).toBe(true);
  });

  it("keeps every data path beneath the root data dir", () => {
    for (const p of [DATA_DIR, RUNS_DIR, PROJECTS_PATH, SESSIONS_PATH]) {
      expect(p.startsWith(DATA_DIR + path.sep) || p === DATA_DIR).toBe(true);
      expect(p).not.toContain(`${path.sep}packages${path.sep}`);
    }
  });
});

describe("ARENA_DATA_DIR test anchor", () => {
  afterEach(() => {
    delete process.env.ARENA_DATA_DIR;
    vi.resetModules();
  });

  it("relocates every data path when the anchor is set (suite isolation)", async () => {
    // Composition suites that mutate durable stores anchor a scratch data dir
    // through this seam before importing the config chain; DATA_DIR and every
    // derived path must move together or half the stores would stay on the
    // operator's real data directory.
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "paths-anchor-"));
    process.env.ARENA_DATA_DIR = scratch;
    vi.resetModules();
    try {
      const anchored = await import("../src/paths.js");
      expect(anchored.DATA_DIR).toBe(path.resolve(scratch));
      expect(anchored.RUNS_DIR).toBe(path.join(path.resolve(scratch), "runs"));
      expect(anchored.SESSIONS_PATH).toBe(path.join(path.resolve(scratch), "sessions.json"));
      expect(anchored.MEMORY_EPISODIC_PATH).toBe(path.join(path.resolve(scratch), "memory_episodic.json"));
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("ignores a blank anchor and keeps the repo data dir", async () => {
    process.env.ARENA_DATA_DIR = "";
    vi.resetModules();
    const unanchored = await import("../src/paths.js");
    expect(unanchored.DATA_DIR).toBe(path.join(unanchored.REPO_ROOT, "data"));
  });
});
