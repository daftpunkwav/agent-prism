/**
 * Dependency policy check (pnpm side): fail on any banned package in the
 * lockfile - direct or transitive. Scans pnpm-lock.yaml's `packages:` section
 * (entry keys look like "/name@version" or "/@scope/name@version"), so an
 * entry in dependency-policy.json blocks every path of arrival. Reads only
 * the lockfile: no install required.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lockPath = join(repoRoot, "pnpm-lock.yaml");
const policyPath = join(repoRoot, "scripts", "ci", "dependency-policy.json");

const policy = JSON.parse(readFileSync(policyPath, "utf8"));
const banned = policy.npm ?? {};

const lock = readFileSync(lockPath, "utf8");

// Scan the whole lockfile, not a single `packages:` section: v9 locks hold
// per-importer packages AND a global snapshots section (two `packages:`
// blocks in multi-importer workspaces), and every entry key is a real
// package regardless of which section lists it. A denylist wants the
// superset.
const found = new Set();
for (const match of lock.matchAll(/^ {2}'?\/?(@?[^@\s]+)@/gm)) {
  found.add(match[1]);
}
if (found.size === 0) {
  console.error("no packages parsed from pnpm-lock.yaml - parse failure?");
  process.exit(1);
}

const violations = [...found].filter((name) => banned[name] !== undefined).sort();

if (violations.length > 0) {
  console.error("banned npm dependencies present:");
  for (const name of violations) {
    console.error(`  - ${name}: ${banned[name]}`);
  }
  process.exit(1);
}
console.log(`npm dependency policy ok (${found.size} packages scanned)`);
