/**
 * @file check-i18n
 * @description i18n consistency gate run before shipping copy changes.
 *
 * Responsibilities:
 * - Delegate catalog key-parity checks to apps/web/tests (catalog-parity)
 * - Sweep app/components source for inline user-visible CJK copy
 *
 * Comments and console calls are stripped before scanning; the allowlist
 * covers known data-like exemptions. Usage: pnpm --filter @agentprism/web
 * check:i18n
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "..", "..");
const SCAN_ROOTS = [
  path.join(WEB_ROOT, "src", "app"),
  path.join(WEB_ROOT, "src", "components"),
];
// Data-like exemptions: sample model inputs are content, not chrome.
const FILE_ALLOWLIST = [/tokenEstimate\.ts$/];
// A line containing this marker is skipped (self-documenting escape hatch for
// intrinsic non-copy CJK, e.g. native language self-names or backend-output matching).
const LINE_EXEMPT_MARKER = "i18n-exempt";
const CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/;

function fail(message) {
  console.error(`[check:i18n] ${message}`);
  process.exitCode = 1;
}

/** Strips block comments, line comments and console.* calls so they are not flagged. */
function stripNonUi(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/console\.(log|warn|error|info)\([^;]*?\);?/g, "");
}

function scanCjk() {
  let hits = 0;
  /** @param {string} dir */
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(tsx?|mts)$/.test(entry.name)) continue;
      if (FILE_ALLOWLIST.some((re) => re.test(entry.name))) continue;
      const lines = stripNonUi(fs.readFileSync(full, "utf8")).split(/\r?\n/);
      lines.forEach((line, index) => {
        if (line.includes(LINE_EXEMPT_MARKER)) return;
        if (CJK.test(line)) {
          hits += 1;
          fail(`inline CJK copy at ${path.relative(REPO_ROOT, full)}:${index + 1}: ${line.trim().slice(0, 120)}`);
        }
      });
    }
  }
  SCAN_ROOTS.forEach(walk);
  return hits;
}

// 1. Catalog contract via the shared vitest suite (exit code propagates).
try {
  execFileSync("pnpm", ["vitest", "run", "apps/web/tests"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    // Windows resolves pnpm via the shell (pnpm.cmd); POSIX shells are unaffected.
    shell: true,
  });
} catch {
  fail("catalog contract suite failed (see vitest output above)");
  process.exit(process.exitCode ?? 1);
}

// 2. Inline CJK sweep.
const hits = scanCjk();
if (hits === 0) {
  console.log("[check:i18n] OK: catalogs symmetric, no inline CJK copy in app/components");
} else {
  fail(`${hits} inline CJK line(s) found — move user-visible copy into i18n catalogs`);
  process.exit(process.exitCode ?? 1);
}
