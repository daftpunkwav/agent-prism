/**
 * @file session-title/normalize
 * @description Title text normalization with a stable fallback chain.
 *
 * Responsibilities:
 * - Collapse whitespace, strip wrapping quotes/code fences, cap length
 * - Fall back through candidates to a stable default (never empty)
 *
 * Titles render in list UIs with tight clamps: normalization keeps one line,
 * and the fallback chain guarantees non-empty output even when every
 * candidate is blank or hostile (whitespace, fences, control characters).
 */

/** Max title length in characters (UI clamp budget). */
export const TITLE_MAX_LENGTH = 80;

/** Fallback title when no candidate survives normalization. */
export const TITLE_FALLBACK = "Untitled session";

/**
 * Normalizes one title candidate (null when unusable).
 * Strips markdown fences/quotes, collapses whitespace, caps with ellipsis.
 */
export function normalizeTitle(candidate: string): string | null {
  let text = candidate.trim();
  const fence = /^```[^\n]*\n([\s\S]*?)\n```$/m.exec(text);
  if (fence?.[1] !== undefined) text = fence[1];
  text = text.replace(/[^\n\t\x20-\x7e\u00a0-\u10ffff]/gu, " ");
  text = text.trim().replace(/^["'「『（(]+|["'」』）)]+$/g, "").replace(/\s+/g, " ").trim();
  if (text === "") return null;
  if (text.length <= TITLE_MAX_LENGTH) return text;
  return `${text.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}

/**
 * First surviving normalization across candidates, else the fallback.
 * Deterministic: same inputs always yield the same title.
 */
export function firstUsableTitle(candidates: readonly string[], fallback: string = TITLE_FALLBACK): string {
  for (const candidate of candidates) {
    const normalized = normalizeTitle(candidate);
    if (normalized !== null) return normalized;
  }
  return fallback;
}
