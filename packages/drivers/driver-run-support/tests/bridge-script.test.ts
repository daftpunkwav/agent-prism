/**
 * @file bridge-script tests
 * @description Locks the bootstrap resolver the framework bridges depend on.
 *
 * Responsibilities:
 * - Pin the walk-up resolution across the build layouts a package can have
 *   (`src/`, flat `dist/`, nested `dist/src/`)
 * - Pin the loud failure with the probed candidates when no bootstrap exists
 *   (the bug this replaced spawned a wrong path and failed at spawn time)
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { BRIDGE_SCRIPT_RELATIVE_PATH, resolveBridgeScript } from "../src/bridge-script.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Lays out a package skeleton and returns the URL of a module inside `layout`. */
function packageWith(layout: string, bootstrap = true): string {
  const root = mkdtempSync(join(tmpdir(), "bridge-script-"));
  roots.push(root);
  const moduleDir = layout === "" ? root : join(root, ...layout.split("/"));
  mkdirSync(moduleDir, { recursive: true });
  if (bootstrap) {
    mkdirSync(join(root, "python"), { recursive: true });
    writeFileSync(join(root, BRIDGE_SCRIPT_RELATIVE_PATH), "# bootstrap\n");
  }
  const modulePath = join(moduleDir, "bridge.js");
  writeFileSync(modulePath, "// built module\n");
  return pathToFileURL(modulePath).href;
}

describe("resolveBridgeScript", () => {
  it("finds the package bootstrap from src/, flat dist/, and nested dist/src/ callers", () => {
    for (const layout of ["src", "dist", "dist/src"]) {
      const resolved = resolveBridgeScript(packageWith(layout));
      // The package's own python/ directory, never a sibling directory one level up
      // (the off-by-one resolution the old hard-coded offset produced).
      const normalized = resolved.replaceAll("\\", "/");
      expect(normalized).toMatch(/\/bridge-script-[^/]+\/python\/bootstrap\.py$/);
      expect(normalized.split("/").slice(-2).join("/")).toBe(BRIDGE_SCRIPT_RELATIVE_PATH.replaceAll("\\", "/"));
    }
  });

  it("fails loudly with every probed candidate when the script is missing", () => {
    expect(() => resolveBridgeScript(packageWith("dist", false))).toThrowError(/bootstrap not found[\s\S]*bootstrap\.py/);
  });
});
