/**
 * @file bm25-fusion test
 * @description Locks BM25 scoring and reciprocal rank fusion.
 */
import { describe, expect, it } from "vitest";
import { Bm25, tokenize } from "../src/bm25.js";
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
