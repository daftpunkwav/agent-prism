/**
 * @file check-export-tests
 * @description Gate: every callable public export must be referenced by a test
 *              harness file. Failures exit non-zero for CI.
 *
 * How it works:
 * - Each workspace package's entry is `src/index.ts`; re-exports are followed
 *   through local bindings (`export { x }`, `export { x as y }`), relative
 *   specifiers, and `@agentprism/*` re-exports, so a callable cannot reach a
 *   barrel disguised as data. An export whose declaration cannot be resolved is
 *   reported instead of being assumed data.
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
    "isAssistantMessage", "isToolMessage", "isUnlimitedSteps",
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
  "@agentprism/session-format": ["SessionMigrationError"],
  "@agentprism/tool-builtins": ["parseSkillFile", "setWebSearchEnvReader", "utf8Bytes"],
  "@agentprism/tool-mcp": ["buildMcpChildEnv"],
};

/**
 * Declarations of one module: name -> { kind, exported }. Local (non-exported)
 * bindings are collected too, because `export { x }` may re-export a binding that
 * was declared without `export`. Kind vocabulary:
 *   callable  behavior the gate expects a test for (functions, classes, arrows)
 *   data      a value or a type: nothing to assert on its own
 *   unknown   the declaration cannot be resolved statically (namespace member,
 *             computed re-export): reported, never assumed to be data
 */
function collectDecls(src) {
  const values = new Map();
  const kindOfInitializer = (body) => (/=>|\bfunction\b/.test(body) ? "callable" : "data");
  const remember = (name, kind, exported) => values.set(name, { kind, exported });
  // `function*` matters: the verification loop and other generators are callables.
  for (const m of src.matchAll(/(?:^|\n)\s*(export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)/g)) remember(m[2], "callable", m[1] !== undefined);
  for (const m of src.matchAll(/(?:^|\n)\s*(export\s+)?class\s+(\w+)/g)) remember(m[2], "callable", m[1] !== undefined);
  for (const m of src.matchAll(/(?:^|\n)\s*(export\s+)?enum\s+(\w+)/g)) remember(m[2], "data", m[1] !== undefined);
  // The initializer is inspected POSITIONALLY, not captured in the pattern: a greedy
  // capture window swallows the declarations that follow it, which used to hide every
  // const whose initializer ran long.
  for (const m of src.matchAll(/(?:^|\n)\s*(export\s+)?const\s+(\w+)\s*(?::[^=\n]*)?=/g)) {
    const from = m.index + m[0].length;
    const body = src.slice(from, from + 240).split(/\n\s*\n/)[0];
    remember(m[2], kindOfInitializer(body), m[1] !== undefined);
  }
  // Types and interfaces are erased at runtime: data.
  for (const m of src.matchAll(/(?:^|\n)\s*(export\s+)?(?:type|interface)\s+(\w+)/g)) remember(m[2], "data", m[1] !== undefined);
  return values;
}

/** Splits one `a, b as c, type D` clause into { imported, exported } pairs. */
function parseExportClause(clause) {
  const pairs = [];
  for (const raw of clause.split(",")) {
    const entry = raw.trim().replace(/^type\s+/, "");
    if (entry === "") continue;
    const [imported, exported] = entry.split(/\s+as\s+/).map((part) => part.trim());
    pairs.push({ imported: imported ?? "", exported: exported ?? imported ?? "" });
  }
  return pairs.filter((pair) => pair.imported !== "");
}

/**
 * Imported bindings of one module: local name -> { spec, imported }. Namespace
 * imports resolve to "*" because their members are not statically known.
 */
function importsOf(src) {
  const bindings = new Map();
  for (const m of src.matchAll(/import\s+(?:type\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']/g)) {
    const clause = m[1];
    const spec = m[2];
    const named = /\{([^}]*)\}/.exec(clause);
    if (named !== null) {
      for (const pair of parseExportClause(named[1])) bindings.set(pair.exported, { spec, imported: pair.imported });
    }
    const beforeBrace = clause.split("{")[0] ?? "";
    if (!beforeBrace.includes("*")) {
      const defaultLocal = beforeBrace.replaceAll(",", " ").trim().split(/\s+/)[0];
      if (defaultLocal !== "" && defaultLocal !== "type") bindings.set(defaultLocal, { spec, imported: "default" });
    }
    const namespace = /\*\s*as\s+(\w+)/.exec(clause);
    if (namespace !== null) bindings.set(namespace[1], { spec, imported: "*" });
  }
  return bindings;
}

/**
 * Source file a specifier points at: relative paths resolve inside the package,
 * `@agentprism/*` resolves to that package's barrel (a compatibility re-export
 * forwards another package's declaration, and its kind must follow it). null for
 * anything else (vendor packages).
 */
function resolveModule(fromFile, spec) {
  if (spec.startsWith(".")) return resolveSpec(fromFile, spec);
  const pkgName = spec.startsWith("@agentprism/") ? spec.split("/").slice(0, 2).join("/") : null;
  if (pkgName === null) return null;
  const pkg = byName.get(pkgName);
  if (pkg === undefined) return null;
  const barrel = path.join(pkg.dir, "src", "index.ts");
  return fs.existsSync(barrel) ? barrel : null;
}

/** Exported surface of a specifier's target module (empty when unresolvable). */
function subSurface(fromFile, spec, cache) {
  const target = resolveModule(fromFile, spec);
  return target === null ? new Map() : exportsOf(target, cache);
}

/**
 * Exported names of one module, each resolved to the declaration that defines it:
 * `{ kind, origin }` where origin is the package (and name) that declares it, or null
 * for a declaration with no package behind it. A forwarding re-export of another
 * package's binding keeps that origin, because the behavior is tested where it is
 * declared — see the coverage rule at the bottom.
 *
 * Results are MEMOIZED per file (`cache`): a module reached twice in one traversal
 * must return the same map, and the entry is registered before recursion so a
 * re-export cycle terminates.
 */
function exportsOf(file, cache = new Map()) {
  const cached = cache.get(file);
  if (cached !== undefined) return cached;
  const values = new Map();
  cache.set(file, values);
  if (!fs.existsSync(file)) return values;
  const src = fs.readFileSync(file, "utf8");
  const declarations = collectDecls(src);
  const imports = importsOf(src);
  const ownerPackage = packageOf(file);
  const localOrigin = ownerPackage === null ? null : { pkg: ownerPackage, name: "" };

  /** Entry for a name declared in this file. */
  const declaredEntry = (name, kind) => ({
    kind: kind === "type" ? "data" : kind,
    origin: localOrigin === null ? null : { pkg: localOrigin.pkg, name },
  });

  /** Entry for a name resolved through this file's bindings (imports or locals). */
  const localEntry = (name) => {
    const declared = declarations.get(name);
    if (declared !== undefined) return declaredEntry(name, declared.kind);
    const imported = imports.get(name);
    if (imported === undefined || imported.imported === "*") return { kind: "unknown", origin: null };
    const sub = subSurface(file, imported.spec, cache);
    const entry = sub.get(imported.imported);
    return entry ?? { kind: "unknown", origin: null };
  };

  // Declarations that carry `export` themselves.
  for (const [name, declaration] of declarations) {
    if (declaration.exported) values.set(name, declaredEntry(name, declaration.kind));
  }

  // `export * from "..."` and `export * as ns from "..."`.
  for (const m of src.matchAll(/export\s*\*\s*from\s*["']([^"']+)["']/g)) {
    for (const [name, entry] of subSurface(file, m[1], cache)) if (!values.has(name)) values.set(name, entry);
  }
  for (const m of src.matchAll(/export\s*\*\s*as\s+(\w+)\s*from\s*["']/g)) values.set(m[1], { kind: "data", origin: null });

  // `export { a, b as c } from "..."`: followed into the source module, so both the
  // kind AND the declaring package survive even when that module re-exports a local
  // binding of its own.
  for (const m of src.matchAll(/export\s+(type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    const typeOnly = m[1] !== undefined;
    const sub = typeOnly ? new Map() : subSurface(file, m[3], cache);
    for (const pair of parseExportClause(m[2])) {
      const entry = sub.get(pair.imported);
      values.set(pair.exported, typeOnly ? { kind: "data", origin: null } : entry ?? { kind: "unknown", origin: null });
    }
  }

  // `export { a, b as c }` with no `from`: the binding is declared here or comes from
  // an import of this module (the case that used to be reported as data).
  for (const m of src.matchAll(/export\s+(type\s+)?\{([^}]*)\}\s*(?!\s*from)(?=[;\n])/g)) {
    const typeOnly = m[1] !== undefined;
    for (const pair of parseExportClause(m[2])) {
      if (typeOnly) values.set(pair.exported, { kind: "data", origin: null });
      else if (!values.has(pair.exported)) values.set(pair.exported, localEntry(pair.imported));
    }
  }

  // A local `export default` is behavior unless it is a plain literal.
  if (/export\s+default\s+/.test(src)) {
    const callable = /export\s+default\s+(?:async\s+)?(?:function|class|\w+\s*=>)/.test(src);
    values.set("default", { kind: callable ? "callable" : "data", origin: null });
  }
  return values;
}

/** Workspace package that owns a source file (null for files outside packages/). */
function packageOf(file) {
  const resolved = path.resolve(file);
  for (const pkg of pkgs) {
    const dir = path.resolve(ROOT, pkg.dir);
    if (resolved.startsWith(dir + path.sep)) return pkg.name;
  }
  return null;
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

/** Resolves a relative specifier to a source file (extension-less, .js in source). */
function resolveSpec(fromFile, spec) {
  const dir = path.dirname(fromFile);
  const base = path.join(dir, spec.replace(/\.js$/, ""));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return base;
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

// Each package's public surface, resolved once (memoized per traversal).
const surfaces = new Map();
for (const pkg of pkgs) {
  const barrel = path.join(pkg.dir, "src", "index.ts");
  surfaces.set(pkg.name, fs.existsSync(barrel) ? exportsOf(barrel) : new Map());
}

const failures = [];
/** Exports whose declaration could not be resolved: reported, never assumed data. */
const unresolved = [];
let callableTotal = 0;
let forwardedTotal = 0;
for (const pkg of pkgs) {
  for (const [name, entry] of surfaces.get(pkg.name)) {
    if (entry.kind === "unknown") {
      unresolved.push(`${pkg.rel}: ${name}`);
      continue;
    }
    if (entry.kind !== "callable") continue;
    callableTotal += 1;
    if (pending.has(`${pkg.name}:${name}`)) continue;
    const origin = entry.origin;
    if (origin !== null && origin.pkg !== pkg.name) {
      // A forwarding re-export of another package's binding: the behavior is tested at
      // the declaring package (the same binding is exposed), so a reference there
      // satisfies this surface too. A reference through THIS package also counts.
      forwardedTotal += 1;
      const originPkg = byName.get(origin.pkg);
      if (originPkg !== undefined && isReferenced(originPkg, origin.name)) continue;
    }
    if (isReferenced(pkg, name)) continue;
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
console.log(`[check-export-tests] pending (no test yet)=${pending.size} · forwarded re-exports=${forwardedTotal}`);

if (unresolved.length > 0) {
  // Neither a pass nor a silent "data": the gate cannot tell whether these need a
  // test, so they are reported for a human decision (export them so their
  // declaration is reachable, or list them in PENDING with a reason).
  console.error(`\n[check-export-tests] ${unresolved.length} export(s) could not be resolved to a declaration:`);
  for (const line of unresolved) console.error(`  ${line}`);
  console.error("\nExport them directly, or list them in PENDING in scripts/check-export-tests.mjs.");
  process.exit(1);
}

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
