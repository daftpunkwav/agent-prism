/**
 * @file context-retrieval/mmr
 * @description Maximal Marginal Relevance diversification.
 *
 * Responsibilities:
 * - Rerank fused hits to balance relevance against redundancy
 * - Keep selection deterministic with stable tie-breaking
 *
 * Top-K by raw score clusters on near-duplicate chunks (same file, adjacent
 * windows): MMR greedily picks the hit maximizing λ·relevance − (1−λ)·max
 * similarity to already-picked hits. Similarity runs on token Jaccard
 * (dependency-free) over caller-supplied token sets.
 */

/** Trade-off between relevance (1) and diversity (0). */
export const MMR_LAMBDA = 0.6;

export interface MmrCandidate {
  id: string;
  relevance: number;
  tokens: ReadonlySet<string>;
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of small) if (big.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

/**
 * Selects up to topK ids balancing relevance and diversity.
 * Returns ids in selection order (most relevant-diverse first).
 */
export function maximalMarginalRelevance(
  candidates: MmrCandidate[],
  topK: number,
  lambda: number = MMR_LAMBDA,
): string[] {
  const picked: MmrCandidate[] = [];
  const remaining = [...candidates].sort((a, b) => b.relevance - a.relevance || (a.id < b.id ? -1 : 1));
  const budget = Math.max(1, Math.min(topK, remaining.length));
  while (picked.length < budget && remaining.length > 0) {
    let best = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i] as MmrCandidate;
      let redundancy = 0;
      for (const chosen of picked) redundancy = Math.max(redundancy, jaccard(candidate.tokens, chosen.tokens));
      const score = lambda * candidate.relevance - (1 - lambda) * redundancy;
      const current = remaining[best] as MmrCandidate;
      if (score > bestScore || (score === bestScore && candidate.id < current.id)) {
        best = i;
        bestScore = score;
      }
    }
    picked.push((remaining.splice(best, 1) as MmrCandidate[])[0] as MmrCandidate);
  }
  return picked.map((candidate) => candidate.id);
}
