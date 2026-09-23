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
 *   support modules such as `mock-deps.ts` and `*fixtures.ts`.
 *
 * PENDING: entries below have no test yet. The list must only ever shrink; delete
 * a line when its symbol gains a test. Adding a symbol here to silence the gate is
 * the one thing this script exists to prevent.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

const PENDING = [
  // packages/contracts/contracts
  "JudgeRequestSchema", "LlmEndpointUpdateSchema",
  "bannerPrefixForFramework", "countActionEvents", "fillWorkspaceNames",
  "isAssistantMessage", "isToolMessage", "isUnlimitedSteps",
  "staticDefaultRuntimeKnobs", "systemErrorEvent", "systemReportEvent",
  "tokenUpdateEvent",
  // packages/harness/harness
  "MapPromptSectionRegistry", "applyCheckpointCompaction",
  "createBuiltinPromptSectionRegistry", "estimateMessageTokens", "extractOriginalQuestion",
  "getBuiltinPromptSectionRegistry", "injectToolResultReminder",
  "reinforceSystemWithQuestion", "withToolGrounding",
  // packages/arena/arena-routing
  "coerceFieldValue", "isFloatField", "isUnlimitedToken", "normalizeOptionToken",
  "snapIntToOptions", "snapToOptions",
  // packages/client/client
  "exportSession", "getSessionStats", "isAbortError", "responseDetail",
  // packages/tools/tool-builtins
  "parseSkillFile", "setWebSearchEnvReader", "utf8Bytes",
  // packages/drivers/driver-autogen
  "isTerminationMessage", "parseSpeakerSelection", "speakerSelectionPrompt",
  // packages/providers/provider-langchain
  "createColumnRuntime", "llmMessagesToLc", "serializeWireResponse",
  // packages/tools/tool-mcp
  "NodeMcpTransport", "buildMcpChildEnv", "mcpServerTools",
  // two-symbol packages
  "eventTurn", "phaseCategoryOfTool",
  "buildCorsOriginList", "toLlmEnvSeed",
  "renderMentionBlock", "resolveMention",
  "REASONING_OPTIONS", "currentEndpointLabel",
  "roleByKey", "roleInstruction",
  "formatCapabilityPluginIds", "selfConsistencyOutcomeEvents",
  "ProviderLookupAdapter", "defaultEnvLookup",
  "readRawBodyText", "settingsOf",
  // single-symbol packages
  "firstIssueMessage", "buildBuilderCatalog", "frameTokens", "replanBudgetFor",
  "criticBudgetFor", "episodicSearchText", "semanticSearchText", "Workspace",
  "shellCommandFromArgs", "SessionMigrationError",
];

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

function importedNames(src) {
  const names = new Set();
  const importRe = /import\s+(?:type\s+)?(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["'][^"']+["']/g;
  for (const m of src.matchAll(importRe)) {
    if (m[1]) names.add(m[1]);
    if (m[2]) {
      for (const raw of m[2].split(",")) {
        const parts = raw.trim().split(/\s+as\s+/);
        const local = (parts[1] ?? parts[0] ?? "").trim();
        if (local !== "") names.add(local);
      }
    }
  }
  for (const m of src.matchAll(/\{\s*([^}]*)\s*\}\s*=\s*await\s+import\(/g)) {
    for (const raw of m[1].split(",")) {
      const parts = raw.trim().split(":");
      const local = (parts[1] ?? parts[0] ?? "").trim();
      if (local !== "") names.add(local);
    }
  }
  return names;
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

const referenced = new Set();
for (const file of harnessFiles) for (const n of importedNames(fs.readFileSync(file, "utf8"))) referenced.add(n);

const pending = new Set(PENDING);
const failures = [];
let callableTotal = 0;
for (const pkg of pkgs) {
  const barrel = path.join(pkg.dir, "src", "index.ts");
  if (!fs.existsSync(barrel)) continue;
  for (const [name, kind] of exportsOf(barrel, new Set())) {
    if (kind !== "callable") continue;
    callableTotal += 1;
    if (referenced.has(name) || pending.has(name)) continue;
    failures.push(`${pkg.rel}: ${name}`);
  }
}

// The list must only ever shrink: a PENDING symbol that a harness file now imports
// has gained its test, so its line has to be deleted. Comparing against `failures`
// cannot see that -- pending names are skipped before they can reach `failures` --
// so match the referenced set instead.
const stale = PENDING.filter((name) => referenced.has(name));

console.log(`[check-export-tests] packages=${pkgs.length} harness files=${harnessFiles.length} callable exports=${callableTotal}`);
console.log(`[check-export-tests] pending (no test yet)=${PENDING.length}`);

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
