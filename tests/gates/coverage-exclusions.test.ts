/**
 * @file coverage exclusion tests
 * @description Locks the honesty of vitest.config.ts's coverage exclusions.
 *
 * Responsibilities:
 * - Pin that every excluded `src/index.ts` is a pure re-export barrel, or is
 *   explicitly allowlisted because its logic has its own test
 * - Pin that allowlisted files really do have a harness reference
 *
 * The config excludes barrel files from coverage because barrels carry no behavior.
 * That claim silently stops being true the moment someone puts logic in a barrel:
 * the file is then invisible to the coverage gate. This test makes the claim
 * checkable instead of trusting it.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

/** Barrels that hold real logic and therefore must keep their own tests. */
const LOGIC_BARRELS = [
  "packages/custom/tool-replay/src/index.ts",
  "packages/custom/memory-top-n/src/index.ts",
  "packages/custom/summary-budget/src/index.ts",
  "apps/web/src/i18n/catalogs/index.ts",
  "apps/web/src/i18n/content/guide/index.ts",
  "apps/web/src/i18n/content/learn/index.ts",
];

/** True when the file declares behavior (a function, class, enum, or a const with a body). */
function hasLogic(source: string): boolean {
  return (
    /export\s+(?:async\s+)?function\s+\w+/.test(source) ||
    /export\s+class\s+\w+/.test(source) ||
    /export\s+enum\s+\w+/.test(source) ||
    /export\s+const\s+\w+\s*(?::[^=\n]*)?=\s*[^;]*=>/.test(source)
  );
}

/**
 * Every file the coverage config's index-barrel exclude hits inside its include
 * roots (each package's src tree and each app's src tree, recursively): the list
 * must mirror what the gate actually skips, or the honesty check misses files.
 */
function allSrcBarrels(): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth = 0): void => {
    if (depth > 6) return;
    let entries: Array<import("node:fs").Dirent>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (["node_modules", "dist", ".next", "tests"].includes(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (entry.name === "index.ts") found.push(full);
    }
  };
  const packagesRoot = join(REPO_ROOT, "packages");
  for (const family of readdirSync(packagesRoot)) {
    const familyDir = join(packagesRoot, family);
    if (!statSync(familyDir).isDirectory()) continue;
    for (const leaf of readdirSync(familyDir)) {
      walk(join(familyDir, leaf, "src"));
    }
  }
  for (const app of readdirSync(join(REPO_ROOT, "apps"))) {
    walk(join(REPO_ROOT, "apps", app, "src"));
  }
  return found.map((file) => relative(REPO_ROOT, file).split(sep).join("/"));
}

describe("coverage exclusions", () => {
  it("only excludes barrels that are pure re-exports or explicitly allowlisted", () => {
    const allowlist = new Set(LOGIC_BARRELS);
    const offenders: string[] = [];
    for (const file of allSrcBarrels()) {
      if (allowlist.has(file)) continue;
      const source = readFileSync(join(REPO_ROOT, file), "utf-8");
      if (hasLogic(source)) offenders.push(file);
    }
    // A new barrel with logic must either lose the exclusion (move the logic out or
    // add the file to LOGIC_BARRELS) — silently hiding it from coverage is not an option.
    expect(offenders).toEqual([]);
  });

  it("keeps every allowlisted barrel and never grows stale entries", () => {
    const present = new Set(allSrcBarrels());
    for (const file of LOGIC_BARRELS) {
      expect(present.has(file), `${file} no longer exists`).toBe(true);
      expect(hasLogic(readFileSync(join(REPO_ROOT, file), "utf-8")), `${file} has no logic`).toBe(true);
    }
  });

  it("references every allowlisted barrel from a test file", () => {
    // Tests import barrels by package name, by the `@/…` alias, or by a relative
    // `src/index` path; any of the three counts as coverage for the exemption.
    const sources: string[] = [];
    const collect = (dir: string, depth = 0): void => {
      let entries: Array<import("node:fs").Dirent>;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (depth < 4 && !["node_modules", "dist", ".next"].includes(entry.name)) collect(full, depth + 1);
          continue;
        }
        if (/\.test\.(ts|tsx)$/.test(entry.name)) sources.push(readFileSync(full, "utf-8"));
      }
    };
    collect(join(REPO_ROOT, "packages"));
    collect(join(REPO_ROOT, "apps"));
    collect(join(REPO_ROOT, "tests"));
    const joined = sources.join("\n");
    const ownTestsReference = (owner: string): boolean => {
      try {
        for (const entry of readdirSync(join(REPO_ROOT, owner, "tests"))) {
          if (!/\.test\.(ts|tsx)$/.test(entry)) continue;
          if (readFileSync(join(REPO_ROOT, owner, "tests", entry), "utf-8").includes("src/index")) return true;
        }
      } catch {
        return false;
      }
      return false;
    };
    for (const file of LOGIC_BARRELS) {
      const owner = file.replace("/src/index.ts", "");
      // A workspace package barrel must be exercised by that package's own tests (a
      // bare filename match would be satisfied by any test file mentioning "index.ts",
      // including this very file). An app barrel (i18n catalogs, guide/learn content)
      // is covered by the suites that import its module path.
      const mentioned = owner.startsWith("packages/")
        ? ownTestsReference(owner)
        : joined.includes(file.split("/src/")[1]?.replace("/index.ts", "") ?? "");
      expect(mentioned, `no test file references ${file}`).toBe(true);
    }
  });
});
