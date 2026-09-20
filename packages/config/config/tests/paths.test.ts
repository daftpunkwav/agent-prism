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

import { describe, expect, it } from "vitest";
import fs from "node:fs";
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
