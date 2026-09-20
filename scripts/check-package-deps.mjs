/**
 * @file check-package-deps
 * @description Dependency-hygiene gate for workspace packages: declared-vs-used
 *              consistency plus value-edge cycle detection. Complements
 *              check-boundaries.mjs (which owns import *direction*); this script
 *              owns import *honesty* (no stale, no missing, no cycles).
 *              Failures exit non-zero for CI.
 *
 * Rules (src/ and tests/; tests resolve through the root alias by convention):
 * - fail: value/dynamic import of an undeclared @agentprism/* package (src/ or tests/)
 * - fail: type-only import of an undeclared @agentprism/* package (src/ or tests/)
 * - fail: value import from a devDependency (consumers would miss it at runtime)
 * - fail: declared runtime dependency used nowhere in src/ nor tests/ (stale)
 * - fail: declared devDependency used nowhere in src/ nor tests/ (stale)
 * - fail: dependency cycle along value/dynamic edges (type-only edges ignored)
 * - warn: declared runtime dependency used only in tests (demote to devDependencies)
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCOPE = "@agentprism/";

function discover() {
  /** @type {{ dir: string; name: string; deps: string[]; devDeps: string[] }[]} */
  const found = [];
  const read = (dir) => {
    const pj = path.join(dir, "package.json");
    if (!fs.existsSync(pj)) return null;
    const json = JSON.parse(fs.readFileSync(pj, "utf8"));
    if (typeof json.name !== "string") return null;
    return {
      dir: path.relative(ROOT, dir),
      name: json.name,
      deps: Object.keys(json.dependencies ?? {}).filter((k) => k.startsWith(SCOPE)),
      devDeps: Object.keys(json.devDependencies ?? {}).filter((k) => k.startsWith(SCOPE)),
    };
  };
  for (const area of ["packages", "apps"]) {
    const areaDir = path.join(ROOT, area);
    if (!fs.existsSync(areaDir)) continue;
    for (const entry of fs.readdirSync(areaDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const direct = read(path.join(areaDir, entry.name));
      if (direct) {
        found.push(direct);
        continue;
      }
      // Capability family: group dirs carry no package.json; leaves do.
      const groupDir = path.join(areaDir, entry.name);
      for (const leaf of fs.readdirSync(groupDir, { withFileTypes: true })) {
        if (!leaf.isDirectory()) continue;
        const pkg = read(path.join(groupDir, leaf.name));
        if (pkg) found.push(pkg);
      }
    }
  }
  return found;
}

function scanImports(srcDir) {
  const value = new Set();
  const typeOnly = new Set();
  const collect = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        collect(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
        for (const m of line.matchAll(/from\s+["'](@agentprism\/[^"']+)["']/g)) {
          const dep = m[1].split("/").slice(0, 2).join("/");
          (/^\s*import\s+type\b/.test(line) ? typeOnly : value).add(dep);
        }
        for (const m of line.matchAll(/import\(\s*["'](@agentprism\/[^"']+)["']/g)) {
          value.add(m[1].split("/").slice(0, 2).join("/"));
        }
      }
    }
  };
  collect(srcDir);
  return { value, typeOnly };
}

const pkgs = discover();
const byName = new Map(pkgs.map((p) => [p.name, p]));
let failed = false;
const fail = (msg) => {
  failed = true;
  console.error(`[package-deps] ${msg}`);
};
const warn = (msg) => console.warn(`[package-deps:warn] ${msg}`);

for (const pkg of pkgs) {
  const self = pkg.name;
  const src = scanImports(path.join(ROOT, pkg.dir, "src"));
  const tests = scanImports(path.join(ROOT, pkg.dir, "tests"));
  const declared = new Set([...pkg.deps, ...pkg.devDeps]);
  const runtime = new Set(pkg.deps);

  for (const dep of [...src.value].filter((d) => d !== self)) {
    if (!declared.has(dep)) fail(`${self}: value/dynamic import of undeclared ${dep}`);
    else if (!runtime.has(dep) && byName.has(dep)) fail(`${self}: value import of ${dep} declared only as devDependency`);
  }
  for (const dep of [...src.typeOnly].filter((d) => d !== self && !src.value.has(d))) {
    if (!declared.has(dep)) fail(`${self}: type-only import of undeclared ${dep}`);
  }
  // Test imports must be declared too: a silent cross-leaf test edge would
  // otherwise bypass both the boundary direction and the dependency graph.
  for (const dep of [...tests.value, ...tests.typeOnly].filter((d) => d !== self)) {
    if (!declared.has(dep)) fail(`${self}: test import of undeclared ${dep} (declare it as a devDependency)`);
  }
  for (const dep of pkg.deps) {
    const inSrc = src.value.has(dep) || src.typeOnly.has(dep);
    const inTests = tests.value.has(dep) || tests.typeOnly.has(dep);
    if (!inSrc && !inTests) fail(`${self}: stale dependency ${dep} (unused in src/ and tests/)`);
    else if (!inSrc && inTests) warn(`${self}: ${dep} is test-only; demote to devDependencies`);
  }
  for (const dep of pkg.devDeps) {
    const inSrc = src.value.has(dep) || src.typeOnly.has(dep);
    const inTests = tests.value.has(dep) || tests.typeOnly.has(dep);
    if (!inSrc && !inTests) fail(`${self}: stale devDependency ${dep} (unused in src/ and tests/)`);
  }
}

// Value-edge cycle detection (type-only edges carry no runtime coupling).
const WHITE = 0;
const GRAY = 1;
const BLACK = 2;
const color = new Map(pkgs.map((p) => [p.name, WHITE]));
const edges = new Map(
  pkgs.map((p) => {
    const src = scanImports(path.join(ROOT, p.dir, "src"));
    return [p.name, [...src.value].filter((d) => d !== p.name && byName.has(d))];
  }),
);
function visit(node, trail) {
  color.set(node, GRAY);
  for (const next of edges.get(node) ?? []) {
    if (color.get(next) === GRAY) fail(`dependency cycle: ${[...trail, next].join(" -> ")}`);
    else if (color.get(next) === WHITE) visit(next, [...trail, next]);
  }
  color.set(node, BLACK);
}
for (const pkg of pkgs) {
  if (color.get(pkg.name) === WHITE) visit(pkg.name, [pkg.name]);
}

if (failed) process.exit(1);
console.log("[package-deps] ok");
