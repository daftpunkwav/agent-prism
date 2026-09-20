/**
 * @file context-retrieval/index-store
 * @description In-memory chunk index with recency weighting and budgeted build.
 *
 * Responsibilities:
 * - Hold chunk records with path/mtime metadata for retrieval
 * - Score queries by BM25 with a recency multiplier for fresh files
 * - Bound index memory by per-file and total chunk caps
 *
 * Recency weighting is explicit and bounded (at most a 2x boost for files
 * touched in the current run): agents iterate on fresh files, so ties between
 * stale docs and live code break toward the code being written. Weights are
 * parameters, never wall-clock reads, keeping scoring deterministic in tests.
 */

import { Bm25, tokenize } from "./bm25.js";

export interface IndexedChunk {
  id: string;
  path: string;
  content: string;
  tokens: ReadonlySet<string>;
  /** Run-relative age rank (0 = freshest); unknown ages use Number.MAX_SAFE_INTEGER. */
  ageRank: number;
}

/** Max chunks kept per file (head-biased: early definitions win ties). */
export const INDEX_PER_FILE_CAP = 200;

/** Max chunks kept index-wide (oldest-indexed files evicted first). */
export const INDEX_TOTAL_CAP = 5000;

/** Freshest file recency multiplier ceiling (decays linearly to 1.0). */
export const RECENCY_CEILING = 2.0;

/** Over how many age ranks the recency boost decays to 1.0. */
export const RECENCY_RANKS = 10;

export interface ScoredHit {
  id: string;
  path: string;
  content: string;
  score: number;
}

/** In-memory retrieval index over workspace chunks. */
export class ChunkIndex {
  private readonly chunks: IndexedChunk[] = [];
  private scorer: Bm25 | null = null;

  /** Chunk count currently held. */
  get size(): number {
    return this.chunks.length;
  }

  /**
   * Adds chunks, enforcing per-file then total caps (oldest additions evict).
   * Rebuilds the BM25 scorer whenever content changes.
   */
  add(chunks: ReadonlyArray<Omit<IndexedChunk, "id" | "tokens">>): void {
    const perFile = new Map<string, number>();
    for (const chunk of this.chunks) perFile.set(chunk.path, (perFile.get(chunk.path) ?? 0) + 1);
    for (const chunk of chunks) {
      const count = perFile.get(chunk.path) ?? 0;
      if (count >= INDEX_PER_FILE_CAP) continue;
      perFile.set(chunk.path, count + 1);
      this.chunks.push({
        ...chunk,
        id: `${chunk.path}#${count}`,
        tokens: new Set(tokenize(chunk.content)),
      });
    }
    while (this.chunks.length > INDEX_TOTAL_CAP) this.chunks.shift();
    this.scorer = new Bm25(this.chunks.map((chunk) => ({ id: chunk.id, text: chunk.content })));
  }

  /** Drops all chunks and the scorer. */
  clear(): void {
    this.chunks.length = 0;
    this.scorer = null;
  }

  private recencyMultiplier(ageRank: number): number {
    if (!Number.isFinite(ageRank) || ageRank < 0) return 1;
    if (ageRank >= RECENCY_RANKS) return 1;
    return RECENCY_CEILING - ((RECENCY_CEILING - 1) * ageRank) / RECENCY_RANKS;
  }

  /**
   * Scores the query across the index (BM25 × recency), top-K descending.
   * Zero-score chunks never return; ties break by fresher file, then id.
   */
  query(query: string, topK = 5): ScoredHit[] {
    if (this.scorer === null || this.chunks.length === 0 || query.trim() === "") return [];
    const scores = this.scorer.score(query);
    return this.chunks
      .map((chunk, index) => ({
        id: chunk.id,
        path: chunk.path,
        content: chunk.content,
        score: (scores[index] ?? 0) * this.recencyMultiplier(chunk.ageRank),
        ageRank: chunk.ageRank,
      }))
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score || a.ageRank - b.ageRank || (a.id < b.id ? -1 : 1))
      .slice(0, Math.max(1, topK))
      .map(({ id, path, content, score }) => ({ id, path, content, score }));
  }
}
