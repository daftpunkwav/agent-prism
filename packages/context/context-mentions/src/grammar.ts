/**
 * @file context-mentions/grammar
 * @description `@file` mention grammar: parse, format, and validate mentions.
 *
 * Responsibilities:
 * - Extract `@path` / `@"spaced path"` mentions from prompt text (email-safe)
 * - Format candidates back into mention text with quoting rules
 * - Validate mention paths against traversal and control characters
 *
 * A mention is `@` followed by a workspace-relative path. Quoted mentions
 * (`@"..."`) allow spaces. A bare `@` with no path is not a mention.
 */

export interface FileMention {
  /** Workspace-relative path as written (without `@` or quotes). */
  path: string;
  /** True when the quoted `@"..."` form was used. */
  quoted: boolean;
  /** Start offset of the full mention token (including `@`/quotes). */
  start: number;
  /** End offset (exclusive) of the full mention token. */
  end: number;
}

/** Control characters (C0/C1) and double quotes can never appear in a mention path. */
function hasIllegalPathChars(path: string): boolean {
  for (const char of path) {
    const code = char.codePointAt(0) ?? 0;
    if (char === '"' || (code >= 0 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/**
 * Extracts all `@file` mentions from text in source order.
 * An `@` glued inside another token (email, decorator) is not a mention:
 * the `@` must start the string or follow whitespace/an opening fence char.
 */
export function parseMentions(text: string): FileMention[] {
  const out: FileMention[] = [];
  const pattern = /(^|[\s([{"'])(@"([^"\n]*?)"|@([^\s"'`]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const opener = match[1] ?? "";
    const quotedBody = match[3];
    const plainBody = match[4];
    const tokenStart = (match.index ?? 0) + opener.length;
    if (quotedBody !== undefined) {
      const path = quotedBody.trim();
      if (path === "") continue;
      out.push({ path, quoted: true, start: tokenStart, end: tokenStart + match[0].length - opener.length });
    } else if (plainBody !== undefined) {
      // Trailing punctuation is prose, not path: strip .,;:!?)] tails.
      const path = plainBody.replace(/[.,;:!?)\]}]+$/, "");
      if (path === "" || path === "@") continue;
      const trimmed = match[0].length - opener.length - (plainBody.length - path.length);
      out.push({ path, quoted: false, start: tokenStart, end: tokenStart + trimmed });
    }
  }
  return out;
}

/** Formats a workspace path as mention text (quotes when spaces demand it). */
export function formatMention(path: string, options: { forceQuote?: boolean } = {}): string | null {
  const clean = path.trim();
  if (clean === "" || hasIllegalPathChars(clean)) return null;
  if (options.forceQuote === true || /\s/.test(clean)) return `@"${clean}"`;
  return `@${clean}`;
}

/** Whether a mention path is resolvable in principle (relative, no traversal). */
export function isResolvableMentionPath(path: string): boolean {
  const clean = path.trim();
  if (clean === "" || clean.startsWith("/") || hasIllegalPathChars(clean)) return false;
  if (clean.includes("\\")) return false;
  return clean.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
