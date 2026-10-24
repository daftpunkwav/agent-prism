/**
 * @file check-workflow-downloads
 * @description Gate enforcing an https-only policy on every curl invocation
 * in the GitHub workflows.
 *
 * Responsibilities:
 * - Fail when a workflow curl omits --proto '=https' (initial request) or
 *   --proto-redir '=https' (redirects): curl keeps two separate protocol
 *   policies, so only both flags rule out a plaintext downgrade
 *
 * Constraint: dependency-free Node so the workflow-lint job can run it right
 * after checkout; the first CLI argument overrides the scanned directory
 * (used by the gate's own regression checks).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const WORKFLOWS_DIR = path.resolve(process.argv[2] ?? path.join(REPO_ROOT, ".github", "workflows"));

const CURL = /(^|\s)curl\s/;
// A bare `https` argument only adds https to the default all-protocols set
// (verified against curl 8: it still downloads over http), so the `=https`
// only-form is required on both flags.
const HTTPS_PROTO = /(^|\s)--proto(?!-)\s+['"]?=https/;
const HTTPS_PROTO_REDIR = /(^|\s)--proto-redir\s+['"]?=https/;

/**
 * Rebuilds the shell's view of a run block: comment lines are dropped and
 * backslash continuations are joined, so a curl spread over several lines is
 * checked as one command.
 */
function logicalLines(text) {
  const lines = [];
  let buffer = null;
  let start = 0;
  text.split(/\r?\n/).forEach((raw, index) => {
    if (buffer === null) {
      if (raw.trim().startsWith("#")) return;
      buffer = raw.trimEnd();
      start = index + 1;
    } else {
      buffer += ` ${raw.trim()}`;
    }
    if (/\\\s*$/.test(buffer)) {
      buffer = buffer.replace(/\\\s*$/, " ");
    } else {
      lines.push({ start, text: buffer });
      buffer = null;
    }
  });
  if (buffer !== null) lines.push({ start, text: buffer });
  return lines;
}

if (!existsSync(WORKFLOWS_DIR)) {
  console.error(`[check-workflow-downloads] workflows directory not found: ${WORKFLOWS_DIR}`);
  process.exit(1);
}

const failures = [];
let invocations = 0;
for (const entry of readdirSync(WORKFLOWS_DIR).sort()) {
  if (!/\.ya?ml$/.test(entry)) continue;
  const file = path.join(WORKFLOWS_DIR, entry);
  for (const { start, text } of logicalLines(readFileSync(file, "utf8"))) {
    if (!CURL.test(text)) continue;
    invocations += 1;
    if (!HTTPS_PROTO.test(text)) {
      failures.push(`${path.relative(REPO_ROOT, file)}:${start}: curl without --proto '=https' (${text.slice(0, 120)})`);
    }
    if (!HTTPS_PROTO_REDIR.test(text)) {
      failures.push(`${path.relative(REPO_ROOT, file)}:${start}: curl without --proto-redir '=https' (${text.slice(0, 120)})`);
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`[check-workflow-downloads] ${failure}`);
  process.exit(1);
}
console.log(`[check-workflow-downloads] OK: ${invocations} curl invocation(s) pinned to https (initial request and redirects)`);
