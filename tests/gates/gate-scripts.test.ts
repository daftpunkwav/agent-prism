/**
 * @file gate script tests
 * @description Locks the three repo gates against fixture trees: each gate must
 *              fail on the defect it exists for and pass on the clean case.
 *
 * Responsibilities:
 * - Run the real gate scripts (copied verbatim) against throwaway fixture repos
 * - Pin the bypasses the review found: dynamic imports, prefix allowlists,
 *   multi-line `import type`, and cross-package export-name collisions
 *
 * The scripts resolve their root from their own location, so a fixture is a temp
 * directory holding `scripts/<gate>.mjs` plus the packages it should judge.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPTS = ["check-boundaries.mjs", "check-package-deps.mjs", "check-export-tests.mjs"];

const temporary: string[] = [];

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Builds a fixture tree: `scripts/` with the real gates plus the given files. */
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "gate-fixture-"));
  temporary.push(root);
  mkdirSync(join(root, "scripts"), { recursive: true });
  for (const script of SCRIPTS) {
    copyFileSync(join(REPO_ROOT, "scripts", script), join(root, "scripts", script));
  }
  for (const [relative, content] of Object.entries(files)) {
    const target = join(root, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
  }
  return root;
}

function runGate(root: string, script: string): { status: number | null; stderr: string; stdout: string } {
  const result = spawnSync(process.execPath, [join(root, "scripts", script)], { encoding: "utf8" });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

const pkgJson = (name: string, deps: Record<string, string> = {}): string =>
  JSON.stringify({ name, version: "0.1.0", dependencies: deps }, null, 2);

describe("check-boundaries", () => {
  it("fails on a static import outside the rule's allowlist", () => {
    const root = fixture({
      "packages/contracts/contracts/package.json": pkgJson("@agentprism/contracts"),
      "packages/contracts/contracts/src/x.ts": 'import { y } from "@agentprism/harness";\n',
    });
    const { status, stderr } = runGate(root, "check-boundaries.mjs");
    expect(status).toBe(1);
    expect(stderr).toContain("contracts → no @agentprism/*");
  });

  it("fails on a dynamic import the same rule forbids", () => {
    const root = fixture({
      "packages/contracts/contracts/package.json": pkgJson("@agentprism/contracts"),
      "packages/contracts/contracts/src/x.ts": 'export const load = () => import("@agentprism/harness");\n',
    });
    const { status, stderr } = runGate(root, "check-boundaries.mjs");
    expect(status).toBe(1);
    expect(stderr).toContain("@agentprism/harness");
  });

  it("does not admit a sibling package through a name prefix", () => {
    const root = fixture({
      "packages/drivers/driver-native/package.json": pkgJson("@agentprism/driver-native"),
      // `driver-run-support` is allowed; `driver-run-support-extra` is not a prefix match.
      "packages/drivers/driver-native/src/x.ts": 'import { y } from "@agentprism/driver-run-support-extra";\n',
    });
    const { status, stderr } = runGate(root, "check-boundaries.mjs");
    expect(status).toBe(1);
    expect(stderr).toContain("driver-run-support-extra");
  });

  it("passes when every import stays inside the allowlist", () => {
    const root = fixture({
      "packages/contracts/contracts/package.json": pkgJson("@agentprism/contracts"),
      "packages/contracts/contracts/src/x.ts": 'import { z } from "zod";\n',
    });
    expect(runGate(root, "check-boundaries.mjs").status).toBe(0);
  });
});

describe("check-package-deps", () => {
  it("fails on a value import that is not declared", () => {
    const root = fixture({
      "packages/contracts/contracts/package.json": pkgJson("@agentprism/contracts"),
      "packages/harness/harness/package.json": pkgJson("@agentprism/harness"),
      "packages/harness/harness/src/x.ts": 'import { y } from "@agentprism/contracts";\n',
    });
    const { status, stderr } = runGate(root, "check-package-deps.mjs");
    expect(status).toBe(1);
    expect(stderr).toContain("value/dynamic import of undeclared @agentprism/contracts");
  });

  it("treats a multi-line `import type` as a type-only edge", () => {
    const root = fixture({
      "packages/contracts/contracts/package.json": pkgJson("@agentprism/contracts"),
      // No value import, and the dependency is declared: a type-only edge must pass.
      "packages/harness/harness/package.json": pkgJson("@agentprism/harness", { "@agentprism/contracts": "workspace:*" }),
      "packages/harness/harness/src/x.ts":
        'import type {\n  A,\n  B,\n} from "@agentprism/contracts";\nexport const use = (a: A, b: B) => [a, b];\n',
    });
    const result = runGate(root, "check-package-deps.mjs");
    expect(result.stderr).not.toContain("value");
    expect(result.status).toBe(0);
  });

  it("still flags a multi-line value import", () => {
    const root = fixture({
      "packages/contracts/contracts/package.json": pkgJson("@agentprism/contracts"),
      "packages/harness/harness/package.json": pkgJson("@agentprism/harness"),
      "packages/harness/harness/src/x.ts": 'import {\n  A,\n} from "@agentprism/contracts";\nexport const use = A;\n',
    });
    expect(runGate(root, "check-package-deps.mjs").status).toBe(1);
  });
});

describe("check-export-tests", () => {
  const withTest = (exportName: string, importedName: string): Record<string, string> => ({
    "packages/tools/tool-x/package.json": pkgJson("@agentprism/tool-x"),
    "packages/tools/tool-x/src/index.ts": `export function ${exportName}(): number {\n  return 1;\n}\n`,
    "packages/tools/tool-x/tests/x.test.ts": `import { ${importedName} } from "@agentprism/tool-x";\n`,
  });

  it("passes when the export is imported from its own package", () => {
    expect(runGate(fixture(withTest("alpha", "alpha")), "check-export-tests.mjs").status).toBe(0);
  });

  it("fails when no harness file references the export", () => {
    const root = fixture({
      "packages/tools/tool-x/package.json": pkgJson("@agentprism/tool-x"),
      "packages/tools/tool-x/src/index.ts": "export function alpha(): number {\n  return 1;\n}\n",
      "packages/tools/tool-x/tests/x.test.ts": "",
    });
    const { status, stderr } = runGate(root, "check-export-tests.mjs");
    expect(status).toBe(1);
    expect(stderr).toContain("alpha");
  });

  it("does not let a same-named export in another package satisfy the requirement", () => {
    const root = fixture({
      "packages/tools/tool-x/package.json": pkgJson("@agentprism/tool-x"),
      "packages/tools/tool-x/src/index.ts": "export function alpha(): number {\n  return 1;\n}\n",
      "packages/tools/tool-x/tests/x.test.ts": "",
      "packages/tools/tool-y/package.json": pkgJson("@agentprism/tool-y"),
      "packages/tools/tool-y/src/index.ts": "export function alpha(): number {\n  return 2;\n}\n",
      "packages/tools/tool-y/tests/y.test.ts": 'import { alpha } from "@agentprism/tool-y";\n',
    });
    const { status, stderr } = runGate(root, "check-export-tests.mjs");
    expect(status).toBe(1);
    expect(stderr).toContain("tool-x");
    expect(stderr).not.toContain("tool-y");
  });
});
