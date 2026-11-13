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
 * Command substitutions are reviewed wherever a shell runs them, including
 * inside double quotes. PowerShell commands are parsed with POSIX quote rules; a
 * PowerShell backtick escape may therefore be treated as a command substitution
 * and reviewed recursively — fail-closed, never fail-open.
 */

import type { ToolArgs } from "@agentprism/contracts";
import type { SandboxPolicy, SandboxVerdict } from "./policy-seam.js";
import { normalizeRemovalTarget, PROTECTED_POSIX_ROOTS, PROTECTED_WINDOWS_ROOTS } from "./removal-targets.js";

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
 * Consumes one `$(...)` or backtick substitution starting at `index`, pushing the
 * inner command's segments for review, and returns the index just past it.
 * Undefined when the character starts no substitution or the recursion cap is
 * reached (the unquoted path fails open at the same cap, deliberately).
 *
 * The substitution does not join the surrounding word: the shell replaces it with
 * output static analysis cannot know, and the inner segments carry the review.
 * This holds inside double quotes too — a shell runs `"$(rm -rf /)"`.
 */
function consumeSubstitution(
  command: string,
  index: number,
  platform: string,
  depth: number,
  segments: CommandSegment[],
): number | undefined {
  if (depth >= MAX_RECURSION_DEPTH) return undefined;
  if (command[index] === "$" && command[index + 1] === "(") {
    const close = matchParen(command, index + 1);
    const inner = close === -1 ? command.slice(index + 2) : command.slice(index + 2, close);
    segments.push(...parseShellCommand(inner, platform, depth + 1));
    return close === -1 ? command.length : close + 1;
  }
  if (command[index] === "`") {
    const end = command.indexOf("`", index + 1);
    const inner = end === -1 ? command.slice(index + 1) : command.slice(index + 1, end);
    segments.push(...parseShellCommand(inner, platform, depth + 1));
    return end === -1 ? command.length : end + 1;
  }
  return undefined;
}

/**
 * Splits a command into segments on unquoted operators (`&&`, `||`, `;`, `|`,
 * `&`, newline), collecting redirections separately. Quotes and backslash
 * escapes are honored (`\` is a literal path separator on win32, not an
 * escape); `$(...)` and backtick substitutions are parsed recursively so their
 * inner commands are judged too, both unquoted and inside double quotes (a
 * shell executes those). Unterminated quotes or substitutions consume to end of
 * input (the shell would reject them anyway).
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
          continue;
        }
        // A double quote suppresses word splitting, not command substitution:
        // `"$(rm -rf /)"` still runs the substitution, so it is reviewed here too.
        const substitutionEnd = consumeSubstitution(command, i, platform, depth, segments);
        if (substitutionEnd !== undefined) {
          i = substitutionEnd;
          continue;
        }
        current += command[i++];
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
    const substitutionEnd = consumeSubstitution(command, i, platform, depth, segments);
    if (substitutionEnd !== undefined) {
      i = substitutionEnd;
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

/** Sudo layers are transparent to attackers; strip repeated prefixes (any case). */
function stripSudo(words: ShellWord[]): ShellWord[] {
  let rest = words;
  while (rest[0]?.text.toLowerCase() === "sudo") rest = rest.slice(1);
  return rest;
}

/** A leading `NAME=value` word: shell syntax for the command's environment, not the command. */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Prefixes that do not change *which* program the segment runs, for the
 * destruction review only: bare `sudo` and leading environment assignments
 * (`FOO=1 rm -rf /`). Launcher commands that need their own flag parsing
 * (`env -i`, `timeout 5`, `xargs`) stay out of static reach, like the
 * interpreter escapes documented above.
 *
 * Deliberately not used by the read-only allowlist: `PATH=... ls` or
 * `LD_PRELOAD=... ls` changes what a "safe" head executes, so an assignment
 * must keep a command out of the known-safe set.
 */
function stripTransparentPrefixes(words: ShellWord[]): ShellWord[] {
  let rest = words;
  for (;;) {
    const head = rest[0];
    if (head === undefined) return rest;
    if (head.text.toLowerCase() === "sudo" || ENV_ASSIGNMENT.test(head.text)) {
      rest = rest.slice(1);
      continue;
    }
    return rest;
  }
}

/** Short-flag probe over lowercased words (`-R` matches "r": chmod -R, rm -R). */
function hasShortFlag(words: ShellWord[], letter: string): boolean {
  return words.some((w) => /^-/.test(w.text) && !w.text.startsWith("--") && w.text.toLowerCase().includes(letter));
}

function hasLongFlag(words: ShellWord[], word: string): boolean {
  return words.some((w) => w.text === `--${word}`);
}

/** Device path prefixes a redirect may never target (block/volume devices only). */
const BLOCK_DEVICE_PREFIXES = ["/dev/sd", "/dev/hd", "/dev/nvme", "/dev/mmcblk", "/dev/vd", "/dev/xvd", "/dev/da", "\\\\.\\physicaldrive"];

/** Registry hives whose bare-root deletion destroys the whole configuration store. */
const REGISTRY_HIVE_ROOTS = new Set(["hklm", "hkcu"]);

/**
 * The program a word invokes, lowercased: path-qualified and `.exe`/`.com`
 * suffixed forms (`/bin/rm`, `C:\Windows\System32\format.com`, `cmd.exe`) name
 * the same program as the bare name, so a name-matching deny rule cannot be
 * dodged by qualifying the path.
 */
function programName(word: string | undefined): string {
  const lower = (word ?? "").toLowerCase();
  const base = lower.slice(Math.max(lower.lastIndexOf("/"), lower.lastIndexOf("\\")) + 1);
  return base.replace(/\.(exe|com)$/, "");
}

/** Interpreter heads that take a command string through a wrapper flag. */
const INTERPRETER_HEADS = new Set(["bash", "sh", "dash", "zsh", "ksh", "cmd", "powershell", "pwsh"]);

/** Wrapper flags per interpreter family: POSIX shells take exactly one word; cmd/PowerShell join the rest. */
const WIN_COMMAND_FLAGS = new Set(["-c", "/c", "-command"]);
// A POSIX shell accepts clustered short flags, and a cluster containing `c`
// carries the command string (`bash -lc 'rm -rf /'`, `sh -ec ...`).
const POSIX_WRAPPER_FLAG = /^-[a-z]*c[a-z]*$/;
// -encodedcommand/-enc/-e carry UTF-16LE base64. The payload is decoded and judged;
// a payload that does not decode is blocked, because the real command is invisible.
const WIN_ENCODED_FLAGS = new Set(["-encodedcommand", "-enc", "-e"]);
const WIN_WRAPPER_FLAGS = new Set([...WIN_COMMAND_FLAGS, ...WIN_ENCODED_FLAGS]);
const ENCODED_COMMAND_BLOCK = "Blocked by sandbox policy: undecodable PowerShell -EncodedCommand";

/**
 * Reviews commands smuggled through an explicit interpreter wrapper
 * (`bash -c 'rm -rf /'`, `cmd /c ...`, `powershell -Command ...`). The
 * wrapped text is re-parsed and judged by the same rules, recursively.
 * Interpreters that take arbitrary code (python -c, node -e, `Invoke-Expression`,
 * `& ([scriptblock]::Create(...))`) are out of static reach and stay documented
 * fail-open: this file is a safety net for the obvious wrappers, not a boundary.
 */
function reviewInterpreterWrapper(segment: CommandSegment, platform: string, depth: number): SandboxVerdict {
  if (depth >= MAX_RECURSION_DEPTH) return null;
  const stripped = stripTransparentPrefixes(segment.words);
  const lowered = stripped.map((w) => w.text.toLowerCase());
  // `cmd.exe` / `powershell.exe` / `/bin/bash` are the same wrappers as their bare names.
  const head = programName(lowered[0]);
  if (!INTERPRETER_HEADS.has(head)) return null;
  const posixFamily = ["bash", "sh", "dash", "zsh", "ksh"].includes(head);
  const isWrapperFlag = (word: string): boolean =>
    posixFamily ? POSIX_WRAPPER_FLAG.test(word) : WIN_WRAPPER_FLAGS.has(word);
  const flagIndex = lowered.findIndex((w, i) => i > 0 && isWrapperFlag(w));
  if (flagIndex === -1) return null;
  const rest = stripped.slice(flagIndex + 1);
  const flag = lowered[flagIndex] ?? "";
  if (!posixFamily && WIN_ENCODED_FLAGS.has(flag)) {
    return reviewEncodedPowerShell(rest[0]?.text ?? "", platform, depth);
  }
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

/** Decodes a PowerShell -EncodedCommand payload (UTF-16LE base64). Null when it is not decodable. */
function decodePowerShellEncoded(payload: string): string | null {
  const compact = payload.replace(/\s+/g, "");
  if (compact.length < 4 || compact.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
  const bytes = Buffer.from(compact, "base64");
  if (bytes.length === 0) return null;
  const roundTrip = bytes.toString("base64").replace(/=+$/, "");
  if (roundTrip !== compact.replace(/=+$/, "")) return null;
  const text = bytes.toString("utf16le");
  return text === "" ? null : text;
}

/** Judges the decoded command. An undecodable payload is blocked: the real command would otherwise be invisible. */
function reviewEncodedPowerShell(payload: string, platform: string, depth: number): SandboxVerdict {
  const decoded = decodePowerShellEncoded(payload);
  if (decoded === null) return ENCODED_COMMAND_BLOCK;
  for (const nested of parseShellCommand(decoded, platform, depth + 1)) {
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
  const rawWords = stripTransparentPrefixes(segment.words);
  const words = rawWords.map((w) => w.text.toLowerCase());
  const head = programName(words[0]);

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
    const targets = rawWords.filter((w) => !w.text.startsWith("-") && w.text.toLowerCase() !== "rm").map((w) => normalizeRemovalTarget(w.text));
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
    const targets = rawWords.filter((w) => !w.text.startsWith("-") && w.text.toLowerCase() !== head).map((w) => normalizeRemovalTarget(w.text));
    if (targets.some((t) => t === "/" || t === "/*")) {
      return `Blocked by sandbox policy: recursive ${head} of filesystem root`;
    }
    return null;
  }
  if (platform === "win32" && (head === "remove-item" || head === "ri")) {
    const recursive = words.some((w) => w === "-recurse" || w.startsWith("-recurse:") || w === "-r" || w === "-rf");
    const forced = words.some((w) => w === "-force" || w.startsWith("-force:") || w === "-f" || w === "-rf");
    const targets = words.filter((w) => !w.startsWith("-") && w !== head).map(normalizeRemovalTarget);
    const hit = targets.find((t) => PROTECTED_WINDOWS_ROOTS.has(t.toLowerCase()));
    if (recursive && forced && hit !== undefined) {
      return `Blocked by sandbox policy: recursive forced removal of ${hit}`;
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
  "stat",
  "du",
  "df",
  "pwd",
  "ls",
  "which",
  "type",
  "whereis",
  "readlink",
  "realpath",
  "basename",
  "dirname",
  "grep",
  "where",
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
  "id",
  "whoami",
  "uname",
  "printenv",
  "sleep",
]);

/**
 * Short options accept attached values and cluster (`-s20200101`, `-Cm`,
 * `-ofile`), so comparing whole words misses the very flag a guard rejects at a
 * later stage. The scan is deliberately coarse and fails closed: a letter that
 * only appears inside another option's attached value is rejected too, which
 * costs a read-only spelling a normal approval, never containment.
 */
function shortOptionLetter(word: string, letters: string): boolean {
  if (!word.startsWith("-") || word.startsWith("--")) return false;
  for (const ch of word.slice(1)) {
    if (letters.includes(ch)) return true;
  }
  return false;
}

/**
 * Long options accept unambiguous prefixes under GNU getopt_long: `--out=FILE`
 * reaches `--output`, `--se=…` reaches `--set`, `--split=…` reaches
 * `--split-string`. Comparing whole spellings therefore misses the very flag a
 * guard rejects. The comparison is one-directional (`name.startsWith(typed)`)
 * and deliberately fail closed: an ambiguous prefix that a real binary would
 * refuse is refused here too, which costs a read-only spelling a normal
 * approval, never containment. The bare `--` terminator never matches.
 */
function longOptionMatches(word: string, name: string): boolean {
  if (!word.startsWith("--")) return false;
  const typed = word.slice(2).split("=", 1)[0] ?? "";
  return typed !== "" && name.startsWith(typed);
}

/**
 * Heads that are safe only under argument constraints; a guard returns true
 * when the argument words keep the command read-only. A guard must reject every
 * form carrying a write or exec argument: false positives (a write waved
 * through) are the one error class this allowlist cannot afford.
 */
const HEAD_GUARDS: Record<string, (words: string[]) => boolean> = {
  find: (words) => !words.some((w) => /^-(delete|exec|execdir|ok|okdir|fls|fprint)/.test(w)),
  // `env CMD` runs the first non-assignment argument; only the print-only forms are read-only.
  // -S/--split-string takes a command string, attached or not (`env -S'rm x'`); GNU
  // env accepts any unambiguous prefix of the long form (`--split=`, `--s=`).
  env: (words) =>
    words.slice(1).every(
      (w) =>
        ENV_ASSIGNMENT.test(w) ||
        (w.startsWith("-") && !shortOptionLetter(w, "S") && !longOptionMatches(w, "split-string")),
    ),
  // --pre runs a program once per file.
  rg: (words) => !words.some((w) => w.startsWith("--pre")),
  // -C/--compile compiles the magic database to disk (clustered as `-Cm` too).
  file: (words) => !words.some((w) => shortOptionLetter(w, "C") || longOptionMatches(w, "compile")),
  // -o/--output writes the listing to a file instead of stdout.
  tree: (words) => !words.some((w) => shortOptionLetter(w, "o") || longOptionMatches(w, "output")),
  // -o writes a file, -T/--temporary-directory writes temp files, --compress-program runs a program.
  sort: (words) =>
    !words.some(
      (w) =>
        shortOptionLetter(w, "oT") ||
        longOptionMatches(w, "output") ||
        longOptionMatches(w, "temporary-directory") ||
        longOptionMatches(w, "compress-program"),
    ),
  // POSIX uniq takes an optional output file: uniq [input [output]].
  uniq: (words) => words.slice(1).filter((w) => !w.startsWith("-")).length <= 1,
  // -o/--output writes the patch to a file (attached as `-ofile`, clustered as `-no`).
  diff: (words) => !words.some((w) => shortOptionLetter(w, "o") || longOptionMatches(w, "output")),
  // -s/--set changes the system clock (attached as `-s20200101`, abbreviated as `--se=`).
  date: (words) => !words.some((w) => shortOptionLetter(w, "s") || longOptionMatches(w, "set")),
  // A bare operand sets the hostname; only the query flags are read-only. -F/--file
  // sets it from a file (attached as `-F/tmp/names`, abbreviated as `--fil=`).
  hostname: (words) =>
    words.slice(1).every(
      (w) => w.startsWith("-") && !shortOptionLetter(w, "F") && !longOptionMatches(w, "file"),
    ),
  git: (words) => isSafeGitInvocation(words.slice(1)),
  npm: (words) => ["ls", "ll", "list", "outdated"].includes(words[1] ?? ""),
  pnpm: (words) => ["ls", "ll", "list", "outdated"].includes(words[1] ?? ""),
  yarn: (words) => ["list", "versions"].includes(words[1] ?? ""),
  node: (words) => words.every((w) => ["node", "-v", "--version"].includes(w)),
  python: (words) => words.every((w) => ["python", "-V", "--version", "-3"].includes(w)),
  python3: (words) => words.every((w) => ["python3", "-V", "--version"].includes(w)),
  pip: (words) => ["list", "show", "--version"].includes(words[1] ?? ""),
  pip3: (words) => ["list", "show", "--version"].includes(words[1] ?? ""),
  // -v means verbose, not version-only: `gcc -v main.c` compiles (and writes a.out).
  gcc: (words) => words.every((w) => w === "gcc" || w === "--version" || w === "-v"),
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

/**
 * `git branch` argument-free query flags. Every other form touches refs: a
 * positional operand creates a branch, and -d/-D delete while -m/-M/-c/-C move
 * or copy and the upstream flags rewrite config. Listing patterns after
 * --list/--contains are operands too, so guards stay fail closed there.
 */
const SAFE_GIT_BRANCH_FLAGS = new Set([
  "-a",
  "--all",
  "-r",
  "--remotes",
  "-l",
  "--list",
  "-v",
  "-vv",
  "--verbose",
  "--show-current",
  "--no-color",
  "--color",
  "--column",
  "--no-column",
  "--omit-empty",
  "--abbrev",
  "--no-abbrev",
  "-i",
  "--ignore-case",
]);

/** Argument guards for git subcommands that are read-only only in some forms. */
function isSafeGitInvocation(args: string[]): boolean {
  const sub = args[0] ?? "";
  if (!SAFE_GIT_SUBCOMMANDS.has(sub)) return false;
  switch (sub) {
    case "branch":
      // Query-only: a positional operand is a new branch name and the mutating
      // flags (-d/-D/-m/-M/-f/-c/-C/-u/--track/--set-upstream-to/…) move refs.
      return args.slice(1).every((w) => SAFE_GIT_BRANCH_FLAGS.has(w));
    case "diff":
    case "log":
    case "show":
      // --output=FILE writes the patch/listing to disk. Prefix matching keeps the
      // guard fail closed for abbreviated spellings as well.
      return !args.some((w) => longOptionMatches(w, "output"));
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
    case "reflog":
      // `expire` and `delete` rewrite the reflog; only listing it is read-only.
      return args.length === 1 || args[1] === "show";
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
