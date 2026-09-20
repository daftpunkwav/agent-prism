/**
 * @file command-analysis
 * @description Quote-aware shell-command analysis behind the layered sandbox policy.
 *
 * Responsibilities:
 * - Parse shell commands into argv-like segments with POSIX quote semantics
 * - Review each segment for irreversible destruction (device writes, root wipes)
 * - Classify read-only commands against a conservative known-safe allowlist
 * - Ship the layered policy that upgrades the legacy deny list with both layers
 *
 * Scope stays "irreversible destruction": known-safe is a read-only allowlist
 * consumed by approval flows, not a general safety oracle. Unclassifiable
 * commands fail open (they run), matching the documented safety-net stance.
 * PowerShell commands are parsed with POSIX quote rules; a PowerShell backtick
 * escape may therefore be treated as a command substitution and reviewed
 * recursively — fail-closed, never fail-open.
 */

import type { ToolArgs } from "@agentprism/contracts";
import type { SandboxPolicy, SandboxVerdict } from "./policy-seam.js";

/** One argv word; `quoted` means part of it came from quotes (literal, certain). */
export interface ShellWord {
  text: string;
  quoted: boolean;
}

/** A redirection operator captured during parsing, with its target word. */
export interface ShellRedirect {
  op: ">" | ">>" | "<";
  target: ShellWord;
}

/** One pipeline-parallel segment: plain words plus redirections. */
export interface CommandSegment {
  words: ShellWord[];
  redirects: ShellRedirect[];
}

/** Maximum nesting (command substitution or interpreter wrapper) reviewed before failing open. */
const MAX_RECURSION_DEPTH = 3;

/** Characters a double quote escapes (POSIX: only dollar, backtick, quote, backslash, newline). */
const DOUBLE_QUOTE_ESCAPABLES = new Set(["$", "`", '"', "\\", "\n"]);

/** Finds the closing paren of `$(...` starting at the open paren index; -1 when unterminated. */
function matchParen(text: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Splits a command into segments on unquoted operators (`&&`, `||`, `;`, `|`,
 * `&`, newline), collecting redirections separately. Quotes and backslash
 * escapes are honored (`\` is a literal path separator on win32, not an
 * escape); `$(...)` and backtick substitutions are parsed recursively so
 * their inner commands are judged too. Unterminated quotes or substitutions
 * consume to end of input (the shell would reject them anyway).
 */
export function parseShellCommand(command: string, platform: string = process.platform, depth = 0): CommandSegment[] {
  const segments: CommandSegment[] = [];
  let words: ShellWord[] = [];
  let redirects: ShellRedirect[] = [];
  let pendingRedirect: ">" | ">>" | "<" | null = null;
  let current = "";
  let currentQuoted = false;

  const flushWord = (): void => {
    if (current === "" && !currentQuoted) return;
    const word: ShellWord = { text: current, quoted: currentQuoted };
    if (pendingRedirect !== null) redirects.push({ op: pendingRedirect, target: word });
    else words.push(word);
    pendingRedirect = null;
    current = "";
    currentQuoted = false;
  };
  const flushSegment = (): void => {
    flushWord();
    if (words.length > 0 || redirects.length > 0) segments.push({ words, redirects });
    words = [];
    redirects = [];
    pendingRedirect = null;
  };

  let i = 0;
  while (i < command.length) {
    const ch = command[i];
    if (ch === "'") {
      currentQuoted = true;
      const end = command.indexOf("'", i + 1);
      if (end === -1) {
        current += command.slice(i + 1);
        i = command.length;
        break;
      }
      current += command.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (ch === '"') {
      currentQuoted = true;
      i++;
      while (i < command.length && command[i] !== '"') {
        if (command[i] === "\\" && DOUBLE_QUOTE_ESCAPABLES.has(command[i + 1] ?? "")) {
          if (command[i + 1] !== "\n") current += command[i + 1];
          i += 2;
        } else {
          current += command[i++];
        }
      }
      i++;
      continue;
    }
    if (ch === "\\") {
      if (platform !== "win32") {
        current += command[i + 1] ?? "";
        i += 2;
      } else {
        current += ch;
        i++;
      }
      continue;
    }
    if (ch === "$" && command[i + 1] === "(" && depth < MAX_RECURSION_DEPTH) {
      const close = matchParen(command, i + 1);
      const inner = close === -1 ? command.slice(i + 2) : command.slice(i + 2, close);
      segments.push(...parseShellCommand(inner, platform, depth + 1));
      if (close === -1) break;
      i = close + 1;
      continue;
    }
    if (ch === "`" && depth < MAX_RECURSION_DEPTH) {
      const end = command.indexOf("`", i + 1);
      const inner = end === -1 ? command.slice(i + 1) : command.slice(i + 1, end);
      segments.push(...parseShellCommand(inner, platform, depth + 1));
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    if (ch === " " || ch === "\t") {
      flushWord();
      i++;
      continue;
    }
    if (ch === "\n" || ch === ";") {
      flushSegment();
      i++;
      continue;
    }
    if (ch === "|" || ch === "&") {
      if (command[i + 1] === ch) i++;
      flushSegment();
      i++;
      continue;
    }
    if (ch === ">") {
      flushWord();
      if (command[i + 1] === ">") {
        pendingRedirect = ">>";
        i++;
      } else {
        pendingRedirect = ">";
      }
      i++;
      continue;
    }
    if (ch === "<") {
      flushWord();
      pendingRedirect = "<";
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  flushSegment();
  return segments;
}

/**
 * Normalizes a removal target for root comparison: all-slash runs become "/",
 * bare drive letters regain their separator, anything else loses trailing
 * separators (so `C:\` still matches the protected drive-root entry, and
 * `/etc/` still matches `/etc`).
 */
function normalizeTarget(target: string): string {
  const stripped = target.replace(/[/\\]+$/, "");
  if (stripped === "") return "/";
  if (/^[a-zA-Z]:$/.test(stripped)) return `${stripped.toLowerCase()}\\`;
  return stripped;
}

/** Sudo layers are transparent to attackers; strip repeated prefixes (any case). */
function stripSudo(words: ShellWord[]): ShellWord[] {
  let rest = words;
  while (rest[0]?.text.toLowerCase() === "sudo") rest = rest.slice(1);
  return rest;
}

/** Short-flag probe over lowercased words (`-R` matches "r": chmod -R, rm -R). */
function hasShortFlag(words: ShellWord[], letter: string): boolean {
  return words.some((w) => /^-/.test(w.text) && !w.text.startsWith("--") && w.text.toLowerCase().includes(letter));
}

function hasLongFlag(words: ShellWord[], word: string): boolean {
  return words.some((w) => w.text === `--${word}`);
}

/**
 * POSIX roots whose recursive forced removal is never legitimate (case-sensitive:
 * Linux paths are; `rm -rf /HOME` targets a different directory than `/home`).
 */
const PROTECTED_POSIX_ROOTS = new Set([
  "/",
  "/*",
  "~",
  "/root",
  "/etc",
  "/usr",
  "/bin",
  "/sbin",
  "/boot",
  "/dev",
  "/proc",
  "/sys",
  "/var",
  "/home",
]);

/** Windows roots (compared case-insensitively: Windows paths are not). */
const PROTECTED_WINDOWS_ROOTS = new Set(["c:\\", "c:\\windows", "c:\\windows\\system32"]);

/** Device path prefixes a redirect may never target (block/volume devices only). */
const BLOCK_DEVICE_PREFIXES = ["/dev/sd", "/dev/hd", "/dev/nvme", "/dev/mmcblk", "/dev/vd", "/dev/xvd", "/dev/da", "\\\\.\\physicaldrive"];

/** Registry hives whose bare-root deletion destroys the whole configuration store. */
const REGISTRY_HIVE_ROOTS = new Set(["hklm", "hkcu"]);

/** Interpreter heads that take a command string through a wrapper flag. */
const INTERPRETER_HEADS = new Set(["bash", "sh", "dash", "zsh", "ksh", "cmd", "powershell", "pwsh"]);

/** Wrapper flags per interpreter family: POSIX shells take exactly one word; cmd/PowerShell join the rest. */
const POSIX_WRAPPER_FLAGS = new Set(["-c"]);
const WIN_WRAPPER_FLAGS = new Set(["-c", "/c", "-command"]);

/**
 * Reviews commands smuggled through an explicit interpreter wrapper
 * (`bash -c 'rm -rf /'`, `cmd /c ...`, `powershell -Command ...`). The
 * wrapped text is re-parsed and judged by the same rules, recursively.
 * Interpreters that take arbitrary code (python -c, node -e) are out of
 * static reach and stay documented fail-open.
 */
function reviewInterpreterWrapper(segment: CommandSegment, platform: string, depth: number): SandboxVerdict {
  if (depth >= MAX_RECURSION_DEPTH) return null;
  const stripped = stripSudo(segment.words);
  const lowered = stripped.map((w) => w.text.toLowerCase());
  const head = lowered[0] ?? "";
  if (!INTERPRETER_HEADS.has(head)) return null;
  const posixFamily = ["bash", "sh", "dash", "zsh", "ksh"].includes(head);
  const wrapperFlags = posixFamily ? POSIX_WRAPPER_FLAGS : WIN_WRAPPER_FLAGS;
  const flagIndex = lowered.findIndex((w, i) => i > 0 && wrapperFlags.has(w));
  if (flagIndex === -1) return null;
  const rest = stripped.slice(flagIndex + 1);
  if (rest.length === 0) return null;
  // POSIX shells take exactly one word as the command string; cmd and
  // PowerShell concatenate the remaining arguments into one command line.
  const innerText = posixFamily ? rest[0]?.text ?? "" : rest.map((w) => w.text).join(" ");
  for (const nested of parseShellCommand(innerText, platform, depth + 1)) {
    const verdict = reviewDestructiveSegment(nested, platform);
    if (verdict !== null) return verdict;
    const wrapped = reviewInterpreterWrapper(nested, platform, depth + 1);
    if (wrapped !== null) return wrapped;
  }
  return null;
}

/**
 * Judges one segment for irreversible destruction. Rules mirror the legacy
 * DenyListSegmentReview (root wipes, filesystem formatting, raw device writes,
 * recursive permission changes) and extend them: redirection into block
 * devices, whole-hive registry deletion, and Windows drive formatting.
 */
function reviewDestructiveSegment(segment: CommandSegment, platform: string): SandboxVerdict {
  const rawWords = stripSudo(segment.words);
  const words = rawWords.map((w) => w.text.toLowerCase());
  const head = words[0] ?? "";

  for (const { op, target } of segment.redirects) {
    if (op === "<") continue;
    const lowered = target.text.toLowerCase();
    const deviceHit = BLOCK_DEVICE_PREFIXES.find((p) => lowered.startsWith(p));
    if (deviceHit !== undefined) {
      return `Blocked by sandbox policy: redirect into block device (${target.text})`;
    }
  }

  if (head === "mkfs" || head.startsWith("mkfs.")) {
    return "Blocked by sandbox policy: filesystem formatting";
  }
  if (head === "format" && platform === "win32" && words.some((w) => /^[a-z]:$/.test(w) || /^[a-z]:\\/.test(w))) {
    return "Blocked by sandbox policy: drive formatting";
  }
  if (head === "reg" && words[1] === "delete") {
    // Only the bare hive root (whole configuration store) is never legitimate;
    // subkey removal (`reg delete HKCU\Software\X /f`) is routine work.
    const hive = words[2] ?? "";
    if (REGISTRY_HIVE_ROOTS.has(hive.toLowerCase())) {
      return `Blocked by sandbox policy: whole-hive registry deletion (${hive})`;
    }
  }
  if (head === "rm" && (hasShortFlag(rawWords, "r") || hasLongFlag(rawWords, "recursive")) && (hasShortFlag(rawWords, "f") || hasLongFlag(rawWords, "force"))) {
    // Targets keep original case (POSIX); the Windows subset compares lowered.
    const targets = rawWords.filter((w) => !w.text.startsWith("-") && w.text.toLowerCase() !== "rm").map((w) => normalizeTarget(w.text));
    const hit = targets.find((t) => PROTECTED_POSIX_ROOTS.has(t) || PROTECTED_WINDOWS_ROOTS.has(t.toLowerCase()));
    if (hit !== undefined) {
      return `Blocked by sandbox policy: recursive forced removal of ${hit}`;
    }
    return null;
  }
  if (head === "dd" && segment.words.some((w) => w.text.toLowerCase().startsWith("of=/dev/"))) {
    return "Blocked by sandbox policy: raw device write";
  }
  if ((head === "chmod" || head === "chown") && hasShortFlag(rawWords, "r")) {
    const targets = rawWords.filter((w) => !w.text.startsWith("-") && w.text.toLowerCase() !== head).map((w) => normalizeTarget(w.text));
    if (targets.some((t) => t === "/" || t === "/*")) {
      return `Blocked by sandbox policy: recursive ${head} of filesystem root`;
    }
    return null;
  }
  if (platform === "win32" && (head === "remove-item" || head === "ri")) {
    const recursive = words.some((w) => w === "-recurse" || w.startsWith("-recurse:") || w === "-r" || w === "-rf");
    const forced = words.some((w) => w === "-force" || w.startsWith("-force:") || w === "-f" || w === "-rf");
    const targets = words.filter((w) => !w.startsWith("-") && w !== head).map(normalizeTarget);
    if (recursive && forced && targets.some((t) => /^[a-z]:\\?$/.test(t))) {
      return `Blocked by sandbox policy: recursive forced removal of ${targets[0]}`;
    }
  }
  return null;
}

/**
 * Read-only command heads with no argument analysis needed. Deliberately
 * small: every entry must be safe under arbitrary arguments except as carved
 * out by HEAD_GUARDS below.
 */
const SAFE_SIMPLE_HEADS = new Set([
  "cat",
  "head",
  "tail",
  "wc",
  "file",
  "stat",
  "du",
  "df",
  "pwd",
  "ls",
  "tree",
  "which",
  "type",
  "whereis",
  "readlink",
  "realpath",
  "basename",
  "dirname",
  "grep",
  "rg",
  "where",
  "sort",
  "uniq",
  "diff",
  "cmp",
  "comm",
  "cut",
  "paste",
  "tr",
  "jq",
  "od",
  "xxd",
  "hexdump",
  "base64",
  "md5sum",
  "sha1sum",
  "sha256sum",
  "sha512sum",
  "echo",
  "printf",
  "date",
  "id",
  "whoami",
  "uname",
  "hostname",
  "env",
  "printenv",
  "sleep",
]);

/**
 * Heads that are safe only under argument constraints; a guard returns true
 * when the argument words keep the command read-only.
 */
const HEAD_GUARDS: Record<string, (words: string[]) => boolean> = {
  find: (words) => !words.some((w) => /^-(delete|exec|execdir|ok|okdir|fls|fprint)/.test(w)),
  git: (words) => isSafeGitInvocation(words.slice(1)),
  npm: (words) => ["ls", "ll", "list", "outdated"].includes(words[1] ?? ""),
  pnpm: (words) => ["ls", "ll", "list", "outdated"].includes(words[1] ?? ""),
  yarn: (words) => ["list", "versions"].includes(words[1] ?? ""),
  node: (words) => words.every((w) => ["node", "-v", "--version"].includes(w)),
  python: (words) => words.every((w) => ["python", "-V", "--version", "-3"].includes(w)),
  python3: (words) => words.every((w) => ["python3", "-V", "--version"].includes(w)),
  pip: (words) => ["list", "show", "--version"].includes(words[1] ?? ""),
  pip3: (words) => ["list", "show", "--version"].includes(words[1] ?? ""),
  gcc: (words) => words.some((w) => w === "--version" || w === "-v"),
  rustc: (words) => words.includes("--version"),
  tsc: (words) => words.includes("--version"),
  go: (words) => words[1] === "version",
  dotnet: (words) => words.includes("--version"),
  java: (words) => words.includes("-version"),
};

/** Git subcommands that are read-only without further argument checks. */
const SAFE_GIT_SUBCOMMANDS = new Set([
  "status",
  "log",
  "show",
  "rev-parse",
  "describe",
  "blame",
  "reflog",
  "shortlog",
  "ls-files",
  "ls-remote",
  "show-branch",
  "count-objects",
  "verify-pack",
  "verify-commit",
  "cat-file",
  "grep",
  "diff",
  "branch",
  "config",
  "remote",
  "tag",
  "stash",
]);

/** Argument guards for git subcommands that are read-only only in some forms. */
function isSafeGitInvocation(args: string[]): boolean {
  const sub = args[0] ?? "";
  if (!SAFE_GIT_SUBCOMMANDS.has(sub)) return false;
  switch (sub) {
    case "branch":
      return !args.some((w) => w === "-d" || w === "-D" || w === "--delete");
    case "diff":
      return !args.some((w) => w.startsWith("--output"));
    case "config": {
      if (args.some((w) => ["--get", "--get-all", "--list", "-l"].includes(w))) return true;
      return args.length <= 2; // `git config <key>` reads; `<key> <value>` writes
    }
    case "remote":
      return args.length <= 1 || args.slice(1).every((w) => w === "-v" || w === "--verbose");
    case "tag":
      return args.length <= 1 || args.slice(1).every((w) => w === "-l" || w === "-n" || w === "--list");
    case "stash":
      return args[1] === "list";
    default:
      return true;
  }
}

/** Redirection targets that carry no write risk. */
const SAFE_REDIRECT_TARGETS = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "nul"]);

/**
 * True when every segment is provably read-only: the head (after sudo
 * stripping) is on the allowlist with its guard satisfied, and all write
 * redirections land on known-safe targets. False negatives are acceptable
 * (the command just gets normal treatment); false positives are not.
 * Background `&` is rejected: its side effects would escape review.
 */
export function isKnownSafeCommand(command: string, platform: string = process.platform): boolean {
  if (/(^|[^&])&($|[^&])/.test(command.replace(/&&/g, ""))) return false;
  const segments = parseShellCommand(command, platform);
  if (segments.length === 0) return false;
  for (const segment of segments) {
    const rawWords = stripSudo(segment.words);
    const head = rawWords[0]?.text.toLowerCase() ?? "";
    for (const { op, target } of segment.redirects) {
      if (op !== "<" && !SAFE_REDIRECT_TARGETS.has(target.text.toLowerCase())) return false;
    }
    const guard = HEAD_GUARDS[head];
    const argWords = rawWords.map((w) => w.text);
    if (guard !== undefined) {
      if (!guard(argWords)) return false;
      continue;
    }
    if (!SAFE_SIMPLE_HEADS.has(head)) return false;
  }
  return true;
}

/**
 * Layered policy: quote-aware parsing (closing the quoted-target bypass of the
 * legacy deny list) plus destruction review per segment. The legacy deny list
 * stays shipped for compatibility; every shape it blocks, this blocks too —
 * the shared MUST_BLOCK test fixture pins that guarantee.
 */
export class LayeredSandboxPolicy implements SandboxPolicy {
  reviewShellCommand(command: string, platform: string = process.platform): SandboxVerdict {
    // The fork-bomb signature spans operators, so it is checked on the raw
    // text before parsing (parsing would shred it into fragments).
    if (command.replace(/\s+/g, "").toLowerCase().includes(":(){:|:&};:")) {
      return "Blocked by sandbox policy: fork bomb";
    }
    for (const segment of parseShellCommand(command, platform)) {
      const verdict = reviewDestructiveSegment(segment, platform);
      if (verdict !== null) return verdict;
      const wrapped = reviewInterpreterWrapper(segment, platform, 0);
      if (wrapped !== null) return wrapped;
    }
    return null;
  }
}

/** Type-guard helper for run-tool argument extraction. */
export function shellCommandFromArgs(args: ToolArgs): string {
  return typeof args.command === "string" ? args.command : "";
}
