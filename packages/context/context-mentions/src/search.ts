/**
 * @file context-mentions/search
 * @description Candidate ranking for `@file` completion over workspace file lists.
 *
 * Responsibilities:
 * - Score files against a partial query (prefix > boundary > substring > fuzzy)
 * - Return a bounded, deterministically ordered candidate list
 *
 * Pure and dependency-free: the caller supplies the file list, this module
 * only ranks. Scoring is deterministic (no wall-clock, no randomness) so
 * completion lists are stable across identical workspaces.
 */

export interface MentionCandidate {
  path: string;
  score: number;
}

/** Max candidates returned per query. */
export const MENTION_SEARCH_LIMIT = 20;

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

/** Cheap ordered-fuzzy score: fraction of query chars matched in order. */
function fuzzyScore(query: string, target: string): number {
  if (query === "") return 0;
  let qi = 0;
  for (const char of target) {
    if (char === query[qi]) qi += 1;
    if (qi >= query.length) break;
  }
  return qi / query.length;
}

/** Scores one file path against the query (higher is better; 0 is no match). */
export function scoreCandidate(query: string, path: string): number {
  const q = query.toLowerCase();
  const full = path.toLowerCase();
  const base = basename(full);
  if (q === "") return 0.5;
  if (base === q || full === q) return 100;
  if (base.startsWith(q)) return 80;
  if (full.startsWith(q)) return 70;
  const boundary = new RegExp(`(^|[/_.-])${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  if (boundary.test(base)) return 60;
  if (boundary.test(full)) return 50;
  if (base.includes(q)) return 40;
  if (full.includes(q)) return 30;
  const fuzzy = fuzzyScore(q, base);
  if (fuzzy >= 0.6) return Math.round(fuzzy * 20);
  return 0;
}

/**
 * Ranks workspace files for a completion query.
 * Ties break by shorter path, then lexicographic order (deterministic).
 */
export function searchMentions(query: string, files: readonly string[], limit: number = MENTION_SEARCH_LIMIT): MentionCandidate[] {
  const scored: MentionCandidate[] = [];
  for (const path of files) {
    const score = scoreCandidate(query, path);
    if (score > 0) scored.push({ path, score });
  }
  scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length || (a.path < b.path ? -1 : 1));
  return scored.slice(0, Math.max(1, limit));
}
