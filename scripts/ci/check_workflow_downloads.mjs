/**
 * @file check-workflow-downloads
 * @description Gate enforcing an https-only policy on every curl invocation
 * in the GitHub workflows.
 *
 * Responsibilities:
 * - Fail when any workflow curl (bare, path-qualified, or curl.exe) runs
 *   without --proto '=https' and --proto-redir '=https': curl keeps separate
 *   protocol policies for the initial request and for redirects, and a bare
 *   protocol name only adds to the default set instead of restricting it
 * - Validate each invocation separately, so flags from one curl cannot
 *   satisfy another one on the same logical line (command substitutions
 *   included), and let the last occurrence of a repeated flag decide
 *
 * Constraint: dependency-free Node so the workflow-lint job can run it right
 * after checkout; the first CLI argument overrides the scanned directory
 * (used by the committed regression tests in tests/gates/).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const WORKFLOWS_DIR = path.resolve(process.argv[2] ?? path.join(REPO_ROOT, ".github", "workflows"));

const PROTO_FLAG = "--proto";
const PROTO_REDIR_FLAG = "--proto-redir";

// A curl invocation starts at the word curl (optionally path-qualified,
// optionally curl.exe) after a shell boundary: line start, whitespace, or one
// of ;&|( (command substitution and separators). `(?=\s|$)` also catches a
// folded-YAML block that leaves curl alone at the end of a physical line, so
// that layout fails the gate instead of escaping it.
const CURL_TOKEN = /(^|[\s;&|(])((?:[^\s;&|(]*[\\/])?curl(?:\.exe)?)(?=\s|$)/g;

/**
 * Rebuilds the shell's view of a run block: comment lines are dropped and
 * backslash continuations are joined, so a command spread over several
 * physical lines is checked as one logical line.
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

/**
 * Splits a logical shell line into one segment per curl invocation: a segment
 * spans exactly the shell command its invocation belongs to, so flag-like text
 * in a later command cannot satisfy the checks.
 */
function curlSegments(command) {
  return [...command.matchAll(CURL_TOKEN)].map((match) => {
    const start = match.index + match[1].length;
    return command.slice(start, commandEnd(command, start, match[1] === "("));
  });
}

/**
 * End of the shell command starting at `start`: scan with quote and
 * command-substitution awareness and stop at the first unquoted separator
 * (`;`, `|`, `&`) or at the closing parenthesis when the invocation sits
 * inside one. Nested substitutions open a tracked depth, so their content and
 * their closing parenthesis stay inside the segment.
 */
function commandEnd(line, start, nestedParen) {
  let inner = 0;
  let quote = null;
  for (let i = start; i < line.length; i += 1) {
    const ch = line[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
    } else if (quote === '"') {
      if (ch === "\\") i += 1;
      else if (ch === '"') quote = null;
    } else if (ch === "'") quote = "'";
    else if (ch === '"') quote = '"';
    else if (ch === "\\") i += 1;
    else if (ch === "(") inner += 1;
    else if (ch === ")") {
      if (inner > 0) inner -= 1;
      else return i;
    } else if (inner === 0 && ";|&".includes(ch)) return i;
  }
  return line.length;
}

/**
 * The value curl will actually use for the flag: within one invocation the
 * last occurrence wins, so an early '=https' cannot satisfy a later broader
 * setting. Optional quotes are stripped from the value.
 */
function effectiveFlag(segment, flag) {
  const matches = [...segment.matchAll(new RegExp(`(?:^|\\s)${flag}\\s+['"]?([^'"\\s]+)`, "g"))];
  return matches.length === 0 ? undefined : matches[matches.length - 1][1];
}

/**
 * Splits a curl command at --next: each chunk holds exactly the options of
 * one transfer, because curl resets its option set there.
 */
function splitTransfers(segment) {
  const bounds = [...segment.matchAll(/(?:^|\s)--next(?=\s|$)/g)];
  if (bounds.length === 0) return [segment];
  const chunks = [];
  let from = 0;
  for (const match of bounds) {
    chunks.push(segment.slice(from, match.index));
    from = match.index + match[0].length;
  }
  chunks.push(segment.slice(from));
  return chunks;
}

/**
 * True when an unquoted `$` expansion appears in the arguments: its value
 * splits into separate curl words, so a static scan cannot know which options
 * it carries. Quoted expansions expand into a single word and stay allowed.
 */
function hasUnquotedExpansion(transfer) {
  let quote = null;
  for (let i = 0; i < transfer.length; i += 1) {
    const ch = transfer[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
    } else if (quote === '"') {
      if (ch === "\\") i += 1;
      else if (ch === '"') quote = null;
    } else if (ch === "'") quote = "'";
    else if (ch === '"') quote = '"';
    else if (ch === "\\") i += 1;
    else if (ch === "$") return true;
  }
  return false;
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
    // Trailing shell comments carry no commands: strip them so flag-like
    // text in a comment cannot satisfy the checks.
    const command = text.replace(/\s#.*$/, "");
    for (const segment of curlSegments(command)) {
      // curl resets its option set at --next: every transfer must carry the
      // pins itself, so the segment is validated per transfer.
      const transfers = splitTransfers(segment);
      transfers.forEach((transfer, index) => {
        invocations += 1;
        const suffix = transfers.length > 1 ? ` (--next transfer ${index + 1})` : "";
        const where = `${path.relative(REPO_ROOT, file)}:${start}`;
        if (hasUnquotedExpansion(transfer)) {
          failures.push(`${where}: curl with unquoted shell expansion in arguments${suffix} (${transfer.slice(0, 120)})`);
          return;
        }
        if (effectiveFlag(transfer, PROTO_FLAG) !== "=https") {
          failures.push(`${where}: curl without --proto '=https'${suffix} (${transfer.slice(0, 120)})`);
        }
        if (effectiveFlag(transfer, PROTO_REDIR_FLAG) !== "=https") {
          failures.push(`${where}: curl without --proto-redir '=https'${suffix} (${transfer.slice(0, 120)})`);
        }
      });
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`[check-workflow-downloads] ${failure}`);
  process.exit(1);
}
console.log(`[check-workflow-downloads] OK: ${invocations} curl invocation(s) pinned to https (initial request and redirects)`);
