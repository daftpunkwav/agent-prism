/**
 * @file bm25-fusion test
 * @description Locks BM25 scoring and reciprocal rank fusion.
 */
import { describe, expect, it } from "vitest";
import { BM25_B, BM25_K1, Bm25, tokenize } from "../src/bm25.js";
import { reciprocalRankFusion, toRanks } from "../src/fusion.js";

describe("tokenize", () => {
  it("splits Latin words and CJK characters", () => {
    expect(tokenize("Hello World")).toEqual(["hello", "world"]);
    expect(tokenize("上下文压缩")).toEqual(["上", "下", "文", "压", "缩"]);
  });
});

describe("Bm25", () => {
  const docs = [
    { id: "a", text: "the quick brown fox jumps over the lazy dog" },
    { id: "b", text: "context compaction strategies for agent memory" },
    { id: "c", text: "context context context compaction" },
  ];
  it("ranks exact topical matches above generic text", () => {
    const scorer = new Bm25(docs);
    const scores = scorer.score("context compaction");
    expect(scores[1]).toBeGreaterThan(scores[0]!);
    expect(scores[2]).toBeGreaterThan(scores[1]!);
    expect(scorer.size).toBe(3);
  });

  it("scores zero for unknown terms", () => {
    expect(new Bm25(docs).score("zzzqqq")).toEqual([0, 0, 0]);
  });

  it("matches a per-query tf recomputation oracle bit-for-bit", () => {
    // The scorer precomputes per-document term frequencies at construction.
    // This oracle keeps the original per-query recomputation side by side and
    // requires identical score vectors, so the precomputation cannot drift
    // from the BM25 definition (mixed Latin/CJK, repeats, empty doc, unknown
    // and repeated query terms).
    const corpus = [
      { id: "a", text: "the quick brown fox jumps over the lazy dog" },
      { id: "b", text: "context compaction strategies for agent memory compaction" },
      { id: "c", text: "context context context compaction" },
      { id: "d", text: "上下文 压缩 策略 context" },
      { id: "e", text: "" },
    ];
    const scorer = new Bm25(corpus);
    const docTokens = corpus.map((doc) => tokenize(doc.text));
    const lengths = docTokens.map((tokens) => tokens.length);
    const avg = docTokens.length === 0 ? 1 : lengths.reduce((sum, len) => sum + len, 0) / docTokens.length || 1;
    const df = new Map<string, number>();
    for (const tokens of docTokens) {
      for (const token of new Set(tokens)) df.set(token, (df.get(token) ?? 0) + 1);
    }
    const idf = new Map<string, number>();
    for (const [token, freq] of df) idf.set(token, Math.log(1 + (docTokens.length - freq + 0.5) / (freq + 0.5)));
    const referenceScore = (query: string): number[] => {
      const queryTerms = new Map<string, number>();
      for (const token of tokenize(query)) queryTerms.set(token, (queryTerms.get(token) ?? 0) + 1);
      return docTokens.map((tokens, index) => {
        const tf = new Map<string, number>();
        for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
        const length = lengths[index] ?? 1;
        let total = 0;
        for (const [term, queryCount] of queryTerms) {
          const weight = idf.get(term);
          if (weight === undefined) continue;
          const freq = tf.get(term) ?? 0;
          if (freq === 0) continue;
          total += weight * ((freq * (BM25_K1 + 1)) / (freq + BM25_K1 * (1 - BM25_B + (BM25_B * length) / avg))) * Math.min(queryCount, 3);
        }
        return total;
      });
    };
    for (const query of ["context compaction", "上下文", "the lazy dog", "zzzqqq", "", "compaction compaction context"]) {
      expect(scorer.score(query)).toEqual(referenceScore(query));
    }
  });
});

describe("reciprocalRankFusion", () => {
  it("fuses ranks without score calibration, deterministically", () => {
    const fused = reciprocalRankFusion([toRanks(["a", "b", "c"]), toRanks(["b", "a"])]);
    expect(fused[0]!.id).toBe("a");
    expect(fused[1]!.id).toBe("b");
    expect(fused.find((f) => f.id === "b")!.lists).toBe(2);
    expect(reciprocalRankFusion([toRanks(["a"])])).toEqual(reciprocalRankFusion([toRanks(["a"])]));
    expect(reciprocalRankFusion([])).toEqual([]);
  });
});
