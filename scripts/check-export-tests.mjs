/**
 * @file check-export-tests
 * @description Gate: every callable public export must be referenced by a test
 *              harness file. Failures exit non-zero for CI.
 *
 * How it works:
 * - Each workspace package's entry is `src/index.ts`; re-exports are followed
 *   within the package so the public surface is complete.
 * - Exports are split into callable (function/class/arrow) and data
 *   (constant/schema/enum). Only callable exports are gated: a constant or a
 *   schema declaration carries no behavior of its own.
 * - "Referenced" means imported by a file under a `tests/` directory, including
 *   support modules such as `mock-deps.ts` and `*fixtures.ts`. References are
 *   attributed to the package they resolve to, so two packages that export the
 *   same name can no longer satisfy each other's requirement.
 *
 * PENDING: entries below have no test yet, grouped by the package that exports
 * them. The list must only ever shrink; delete a line when its symbol gains a
 * test. Adding a symbol here to silence the gate is the one thing this script
 * exists to prevent.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

const PENDING = {
  "@agentprism/application": ["firstIssueMessage"],
  "@agentprism/arena-dimensions": [
    "coerceFieldValue", "isFloatField", "isUnlimitedToken", "normalizeOptionToken",
    "snapIntToOptions", "snapToOptions",
  ],
  "@agentprism/arena-view": ["eventTurn", "phaseCategoryOfTool"],
  "@agentprism/client": ["exportSession", "getSessionStats", "isAbortError", "responseDetail"],
  "@agentprism/config": ["buildCorsOriginList", "toLlmEnvSeed"],
  "@agentprism/context-compaction": ["frameTokens"],
  "@agentprism/context-mentions": ["renderMentionBlock", "resolveMention"],
  "@agentprism/contracts": [
    "JudgeRequestSchema", "bannerPrefixForFramework", "countActionEvents", "fillWorkspaceNames",
    "isAssistantMessage", "isToolMessage", "isUnlimitedSteps", "staticDefaultRuntimeKnobs",
    "systemErrorEvent", "systemReportEvent", "tokenUpdateEvent",
  ],
  "@agentprism/dimensions": ["REASONING_OPTIONS", "currentEndpointLabel"],
  "@agentprism/driver-autogen": ["isTerminationMessage", "parseSpeakerSelection"],
  "@agentprism/driver-crewai": ["roleByKey", "roleInstruction"],
  "@agentprism/driver-plan-execute": ["replanBudgetFor"],
  "@agentprism/driver-run-support": ["formatCapabilityPluginIds", "selfConsistencyOutcomeEvents"],
  "@agentprism/driver-self-critique": ["criticBudgetFor"],
  "@agentprism/harness": [
    "MapPromptSectionRegistry", "applyCheckpointCompaction", "createBuiltinPromptSectionRegistry",
    "estimateMessageTokens", "extractOriginalQuestion", "getBuiltinPromptSectionRegistry",
    "injectToolResultReminder", "reinforceSystemWithQuestion", "withToolGrounding",
  ],
  "@agentprism/http-runtime": ["readRawBodyText", "settingsOf"],
  "@agentprism/memory-episodic": ["episodicSearchText"],
  "@agentprism/memory-semantic": ["semanticSearchText"],
  "@agentprism/provider-catalog": ["ProviderLookupAdapter", "defaultEnvLookup"],
  "@agentprism/provider-langchain": ["createColumnRuntime", "llmMessagesToLc", "serializeWireResponse"],
  "@agentprism/runtime": ["Workspace"],
  "@agentprism/sandbox": ["shellCommandFromArgs"],
  "@agentprism/session-format": ["SessionMigrationError"],
  "@agentprism/tool-builtins": ["parseSkillFile", "setWebSearchEnvReader", "utf8Bytes"],
  "@agentprism/tool-mcp": ["buildMcpChildEnv"],
};

function collectDecls(src, values) {
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) values.set(m[1], "callable");
  for (const m of src.matchAll(/export\s+class\s+(\w+)/g)) values.set(m[1], "callable");
  for (const m of src.matchAll(/export\s+enum\s+(\w+)/g)) values.set(m[1], "data");
  for (const m of src.matchAll(/export\s+const\s+(\w+)\s*(?::[^=\n]*)?=\s*([\s\S]{0,320})/g)) {
    const body = m[2].split(/\n\s*\n/)[0];
    values.set(m[1], /=>|\bfunction\b/.test(body) ? "callable" : "data");
  }
}

function listPackages() {
  const out = [];
  const pkgsRoot = path.join(ROOT, "packages");
  for (const family of fs.readdirSync(pkgsRoot)) {
    const famDir = path.join(pkgsRoot, family);
    if (!fs.statSync(famDir).isDirectory()) continue;
    for (const leaf of fs.readdirSync(famDir)) {
      const dir = path.join(famDir, leaf);
      const pj = path.join(dir, "package.json");
      if (!fs.existsSync(pj)) continue;
      const json = JSON.parse(fs.readFileSync(pj, "utf8"));
      if (typeof json.name !== "string") continue;
      out.push({ name: json.name, dir, rel: path.relative(ROOT, dir).replaceAll("\\", "/") });
    }
  }
  return out;
}

function resolveSpec(fromFile, spec) {
  const dir = path.dirname(fromFile);
  const base = path.join(dir, spec.replace(/\.js$/, ""));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return base;
}

function exportsOf(file, seen) {
  const values = new Map();
  if (!fs.existsSync(file) || seen.has(file)) return values;
  seen.add(file);
  const src = fs.readFileSync(file, "utf8");
  collectDecls(src, values);
  for (const m of src.matchAll(/export\s*\*\s*from\s*["']\.\/([^"']+)["']/g)) {
    for (const [k, v] of exportsOf(resolveSpec(file, m[1]), seen)) if (!values.has(k)) values.set(k, v);
  }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}\s*from\s*["']\.\/([^"']+)["']/g)) {
    const sub = exportsOf(resolveSpec(file, m[2]), seen);
    for (const raw of m[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name === "") continue;
      values.set(name, sub.get(name) ?? "data");
    }
  }
  return values;
}

function walkHarnessFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", ".next"].includes(entry.name)) continue;
      walkHarnessFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

const IMPORT_RE = /import\s+(?:type\s+)?(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["']([^"']+)["']/g;

function namesOf(clause) {
  const names = [];
  if (clause === undefined) return names;
  for (const raw of clause.split(",")) {
    const local = raw.trim().split(/\s+as\s+/).pop() ?? "";
    if (local !== "") names.push(local);
  }
  return names;
}

/** Imported names grouped by the module specifier that provides them. */
function importedModules(src) {
  const out = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    const names = [...namesOf(m[1]), ...namesOf(m[2])];
    if (names.length > 0) out.push({ spec: m[3], names });
  }
  for (const m of src.matchAll(/\{\s*([^}]*)\s*\}\s*=\s*await\s+import\(\s*["']([^"']+)["']\s*\)/g)) {
    const names = namesOf(m[1].replaceAll(":", ", "));
    if (names.length > 0) out.push({ spec: m[2], names });
  }
  return out;
}

/**
 * Package a specifier resolves to, or null when it leaves the workspace. Dynamic
 * and relative imports are attributed like static ones, so a package cannot
 * satisfy a requirement through an import the reader did not expect.
 */
function ownerPackage(fromFile, spec, byName, pkgs) {
  if (spec.startsWith("@agentprism/")) {
    const name = spec.split("/").slice(0, 2).join("/");
    return byName.has(name) ? name : null;
  }
  if (!spec.startsWith(".")) return null;
  const resolved = resolveSpec(fromFile, spec);
  const hit = pkgs.find((pkg) => resolved.startsWith(pkg.dir + path.sep) || resolved === pkg.dir);
  return hit ? hit.name : null;
}

const pkgs = listPackages();
const harnessRoots = [
  path.join(ROOT, "tests"),
  ...pkgs.map((p) => path.join(p.dir, "tests")),
  path.join(ROOT, "apps", "server", "tests"),
  path.join(ROOT, "apps", "web", "tests"),
];
const harnessFiles = [];
for (const root of harnessRoots) if (fs.existsSync(root)) walkHarnessFiles(root, harnessFiles);

const byName = new Map(pkgs.map((pkg) => [pkg.name, pkg]));
/** referenced.get(pkgName) = names harness files import from that package. */
const referenced = new Map();
for (const file of harnessFiles) {
  for (const { spec, names } of importedModules(fs.readFileSync(file, "utf8"))) {
    const owner = ownerPackage(file, spec, byName, pkgs);
    if (owner === null) continue;
    const bucket = referenced.get(owner) ?? new Set();
    for (const name of names) bucket.add(name);
    referenced.set(owner, bucket);
  }
}

const pending = new Set(Object.entries(PENDING).flatMap(([pkg, names]) => names.map((n) => `${pkg}:${n}`)));
const isReferenced = (pkg, name) => referenced.get(pkg.name)?.has(name) === true;
const failures = [];
let callableTotal = 0;
for (const pkg of pkgs) {
  const barrel = path.join(pkg.dir, "src", "index.ts");
  if (!fs.existsSync(barrel)) continue;
  for (const [name, kind] of exportsOf(barrel, new Set())) {
    if (kind !== "callable") continue;
    callableTotal += 1;
    if (isReferenced(pkg, name) || pending.has(`${pkg.name}:${name}`)) continue;
    failures.push(`${pkg.rel}: ${name}`);
  }
}

// The list must only ever shrink: a PENDING symbol that a harness file now imports
// has gained its test, so its line has to be deleted. Comparing against `failures`
// cannot see that -- pending names are skipped before they can reach `failures` --
// so match the referenced set instead.
const stale = Object.entries(PENDING).flatMap(([pkgName, names]) =>
  names.filter((name) => referenced.get(pkgName)?.has(name) === true).map((name) => `${pkgName}: ${name}`),
);

console.log(`[check-export-tests] packages=${pkgs.length} harness files=${harnessFiles.length} callable exports=${callableTotal}`);
console.log(`[check-export-tests] pending (no test yet)=${pending.size}`);

if (failures.length > 0) {
  console.error(`\n[check-export-tests] ${failures.length} callable export(s) have no test and are not listed as pending:`);
  for (const line of failures) console.error(`  ${line}`);
  console.error("\nAdd a test, or add the symbol to PENDING in scripts/check-export-tests.mjs.");
  process.exit(1);
}

if (stale.length > 0) {
  console.error(`\n[check-export-tests] ${stale.length} PENDING entry(ies) already have a test; delete these lines:`);
  for (const name of stale) console.error(`  ${name}`);
  process.exit(1);
}

console.log("[check-export-tests] ok: no unlisted callable export is missing a test");
