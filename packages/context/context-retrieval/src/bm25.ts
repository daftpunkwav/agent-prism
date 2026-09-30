/**
 * @file context-retrieval/bm25
 * @description Okapi BM25 scorer with CJK-capable tokenization.
 *
 * Responsibilities:
 * - Tokenize queries and documents (Latin words plus CJK characters)
 * - Score documents with length-normalized term saturation (k1/b)
 *
 * BM25 complements TF-IDF cosine (which over-rewards long documents): term
 * saturation caps repeated-keyword stuffing while length normalization keeps
 * short exact matches competitive. Deterministic and dependency-free.
 */

export interface Bm25Document {
  id: string;
  text: string;
}

/** BM25 saturation (k1) and length-normalization (b) defaults. */
export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

/** Tokenizes into lowercase Latin words plus individual CJK characters. */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]/g) ?? [];
}

/** Term frequencies of one token list. */
function termFrequencies(tokens: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const token of tokens) out.set(token, (out.get(token) ?? 0) + 1);
  return out;
}

/** BM25 scorer bound to a fixed corpus (idf fitted at construction). */
export class Bm25 {
  private readonly docTfs: Map<string, number>[];
  private readonly docLengths: number[];
  private readonly avgLength: number;
  private readonly idf = new Map<string, number>();
  private readonly k1: number;
  private readonly b: number;

  constructor(documents: Bm25Document[], options: { k1?: number; b?: number } = {}) {
    this.k1 = options.k1 ?? BM25_K1;
    this.b = options.b ?? BM25_B;
    // Term frequencies are query-invariant: tokenize and count once here, so
    // score() is a per-query-term lookup instead of re-counting the whole
    // corpus on every call (queries run per LLM call; the corpus does not change).
    const tokenized = documents.map((doc) => tokenize(doc.text));
    this.docTfs = tokenized.map((tokens) => termFrequencies(tokens));
    this.docLengths = tokenized.map((tokens) => tokens.length);
    const total = this.docLengths.reduce((sum, len) => sum + len, 0);
    this.avgLength = this.docTfs.length === 0 ? 1 : total / this.docTfs.length || 1;
    const docCount = this.docTfs.length;
    const df = new Map<string, number>();
    for (const tf of this.docTfs) {
      for (const token of tf.keys()) df.set(token, (df.get(token) ?? 0) + 1);
    }
    for (const [token, freq] of df) {
      this.idf.set(token, Math.log(1 + (docCount - freq + 0.5) / (freq + 0.5)));
    }
  }

  /** Scores every corpus document against the query (index-aligned). */
  score(query: string): number[] {
    const queryTerms = termFrequencies(tokenize(query));
    return this.docTfs.map((tf, index) => {
      const length = this.docLengths[index] ?? 1;
      let total = 0;
      for (const [term, queryCount] of queryTerms) {
        const idf = this.idf.get(term);
        if (idf === undefined) continue;
        const freq = tf.get(term) ?? 0;
        if (freq === 0) continue;
        const numerator = freq * (this.k1 + 1);
        const denominator = freq + this.k1 * (1 - this.b + (this.b * length) / this.avgLength);
        total += idf * (numerator / denominator) * Math.min(queryCount, 3);
      }
      return total;
    });
  }

  /** Corpus size (number of indexed documents). */
  get size(): number {
    return this.docTfs.length;
  }
}
