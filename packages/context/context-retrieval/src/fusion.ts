/**
 * @file context-retrieval/fusion
 * @description Reciprocal Rank Fusion across heterogeneous rank lists.
 *
 * Responsibilities:
 * - Fuse BM25 / TF-IDF / keyword rank lists without score calibration
 * - Keep fusion deterministic with stable tie-breaking
 *
 * Different scorers live on incomparable scales (BM25 unbounded, cosine
 * 0..1): RRF fuses ranks instead of scores, so adding a new signal never
 * requires renormalizing the old ones. Higher fused score wins; ties break by
 * best single rank, then id order.
 */

export interface RankedItem {
  id: string;
  /** 0-based rank within its own list (lower is better). */
  rank: number;
}

/** RRF damping constant (standard 60). */
export const RRF_K = 60;

export interface FusedItem {
  id: string;
  score: number;
  /** Best rank achieved in any input list. */
  bestRank: number;
  /** How many input lists contained the id. */
  lists: number;
}

/**
 * Fuses rank lists by reciprocal rank: score(id) = Σ 1/(k + rank).
 * Empty lists are ignored; ids in no list never appear.
 */
export function reciprocalRankFusion(lists: RankedItem[][], k: number = RRF_K): FusedItem[] {
  const acc = new Map<string, { score: number; bestRank: number; lists: number }>();
  for (const list of lists) {
    for (const item of list) {
      const entry = acc.get(item.id) ?? { score: 0, bestRank: item.rank, lists: 0 };
      entry.score += 1 / (k + item.rank + 1);
      entry.bestRank = Math.min(entry.bestRank, item.rank);
      entry.lists += 1;
      acc.set(item.id, entry);
    }
  }
  return [...acc.entries()]
    .map(([id, entry]) => ({ id, ...entry }))
    .sort((a, b) => b.score - a.score || a.bestRank - b.bestRank || (a.id < b.id ? -1 : 1));
}

/** Converts a score-descending id list into rank items for fusion input. */
export function toRanks(ids: readonly string[]): RankedItem[] {
  return ids.map((id, rank) => ({ id, rank }));
}
