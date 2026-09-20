/**
 * @file sandbox-policy
 * @description Shell-command sandbox policies for the run tool.
 *
 * Responsibilities:
 * - Define the SandboxPolicy seam (verdict per shell command)
 * - Ship allow-all (explicit opt-out) and catastrophic-deny-list implementations
 *
 * The default policy wired through toBeforeExecute is the quote-aware layered
 * analysis in command-analysis.ts; this deny list is the legacy quotes-unaware
 * path, kept for compatibility and pinned by its own tests.
 *
 * Scope is deliberately narrow: irreversible filesystem destruction only.
 * Reboots, piped installers (curl|sh), and repo-scoped wipes (git clean, rm of
 * relative paths) are intentionally allowed — blocking them would cripple
 * legitimate agent work. Quoted-operator obfuscation may fail open; this is a
 * safety net, not a security boundary (documented, not silent).
 */

import type { ToolArgs } from "@agentprism/contracts";
import { LayeredSandboxPolicy } from "./command-analysis.js";
import type { SandboxPolicy, SandboxVerdict } from "./policy-seam.js";

export type { SandboxPolicy, SandboxVerdict } from "./policy-seam.js";

/** Explicit opt-out: allows everything (documents the absence of protection). */
export class AllowAllSandboxPolicy implements SandboxPolicy {
  reviewShellCommand(_command: string, _platform?: string): SandboxVerdict {
    return null;
  }
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

/**
 * Normalizes a removal target for root comparison: all-slash runs become "/",
 * bare drive letters regain their separator; anything else loses trailing
 * separators (so `C:\` still matches the protected drive-root entry).
 */
function normalizeTarget(target: string): string {
  const stripped = target.replace(/[/\\]+$/, "");
  if (stripped === "") return "/";
  if (/^[a-zA-Z]:$/.test(stripped)) return `${stripped.toLowerCase()}\\`;
  return target;
}

/** Sudo layers are transparent to attackers; strip repeated prefixes (any case). */
function stripSudo(tokens: string[]): string[] {
  let rest = tokens;
  while (rest[0]?.toLowerCase() === "sudo") rest = rest.slice(1);
  return rest;
}

function hasShortFlag(tokens: string[], letter: string): boolean {
  return tokens.some((t) => /^-/.test(t) && !t.startsWith("--") && t.includes(letter));
}

function hasLongFlag(tokens: string[], word: string): boolean {
  return tokens.includes(`--${word}`);
}

/**
 * Deny-list policy: blocks irreversible filesystem destruction, allows the rest.
 * Matching is segment-based (split on ; && || | and newlines, quotes-unaware)
 * so `echo rm -rf /` (prints text) passes while `echo hi; rm -rf /` is caught.
 */
export class DenyListSandboxPolicy implements SandboxPolicy {
  reviewShellCommand(command: string, platform: string = process.platform): SandboxVerdict {
    // The fork-bomb signature spans operators, so it is checked whole before
    // segmenting (segmenting first would shred the signature into fragments).
    if (command.replace(/\s+/g, "").toLowerCase().includes(":(){:|:&};")) {
      return "Blocked by sandbox policy: fork bomb";
    }
    const segments = command.split(/\s*(?:&&|\|\||[;|\n])\s*/);
    for (const segment of segments) {
      const verdict = reviewSegment(segment, platform);
      if (verdict !== null) return verdict;
    }
    return null;
  }
}

function reviewSegment(segment: string, platform: string): SandboxVerdict {
  const collapsed = segment.trim().replace(/\s+/g, " ");
  if (collapsed === "") return null;
  const rawTokens = stripSudo(collapsed.split(" ").filter((t) => t !== ""));
  const tokens = rawTokens.map((t) => t.toLowerCase());
  const head = tokens[0] ?? "";
  if (head === "mkfs" || head.startsWith("mkfs.")) {
    return "Blocked by sandbox policy: filesystem formatting";
  }
  if (head === "rm" && (hasShortFlag(tokens, "r") || hasLongFlag(tokens, "recursive")) && (hasShortFlag(tokens, "f") || hasLongFlag(tokens, "force"))) {
    // Targets keep original case (POSIX); the Windows subset compares lowered.
    const targets = rawTokens.filter((t) => !t.startsWith("-") && t.toLowerCase() !== "rm").map(normalizeTarget);
    const hit = targets.find((t) => PROTECTED_POSIX_ROOTS.has(t) || PROTECTED_WINDOWS_ROOTS.has(t.toLowerCase()));
    if (hit !== undefined) {
      return `Blocked by sandbox policy: recursive forced removal of ${hit}`;
    }
    return null;
  }
  if (head === "dd" && tokens.some((t) => t.startsWith("of=/dev/"))) {
    return "Blocked by sandbox policy: raw device write";
  }
  if ((head === "chmod" || head === "chown") && hasShortFlag(tokens, "r")) {
    const targets = tokens.filter((t) => !t.startsWith("-") && t !== head).map(normalizeTarget);
    if (targets.some((t) => t === "/" || t === "/*")) {
      return `Blocked by sandbox policy: recursive ${head} of filesystem root`;
    }
    return null;
  }
  if (platform === "win32" && (head === "remove-item" || head === "ri")) {
    const recursive = tokens.some((t) => t === "-recurse" || t.startsWith("-recurse:") || t === "-r" || t === "-rf");
    const forced = tokens.some((t) => t === "-force" || t.startsWith("-force:") || t === "-f" || t === "-rf");
    const targets = tokens.filter((t) => !t.startsWith("-") && t !== head).map(normalizeTarget);
    if (recursive && forced && targets.some((t) => /^[a-z]:\\?$/.test(t))) {
      return `Blocked by sandbox policy: recursive forced removal of ${targets[0]}`;
    }
  }
  return null;
}

/**
 * Adapts a policy to the registry beforeExecute hook: only the run, run_job,
 * and bash_session tools carry shell commands (the latter two start shells or
 * feed them); every other tool passes through untouched.
 */
export function toBeforeExecute(
  policy: SandboxPolicy = new LayeredSandboxPolicy(),
): (name: string, args: ToolArgs) => string | null {
  return (name: string, args: ToolArgs) => {
    if (name !== "run" && name !== "run_job" && name !== "bash_session") return null;
    const command = typeof args.command === "string" ? args.command : "";
    if (command.trim() === "") return null;
    return policy.reviewShellCommand(command);
  };
}
