/**
 * @file mmr-index test
 * @description Locks MMR diversification and the recency-weighted chunk index.
 */
import { describe, expect, it } from "vitest";
import { maximalMarginalRelevance } from "../src/mmr.js";
import { ChunkIndex } from "../src/index-store.js";

describe("maximalMarginalRelevance", () => {
  it("prefers diverse picks over redundant near-duplicates", () => {
    const picked = maximalMarginalRelevance(
      [
        { id: "a", relevance: 0.9, tokens: new Set(["agent", "loop"]) },
        { id: "b", relevance: 0.89, tokens: new Set(["agent", "loop"]) },
        { id: "c", relevance: 0.5, tokens: new Set(["context", "budget"]) },
      ],
      2,
    );
    expect(picked).toEqual(["a", "c"]);
  });

  it("returns relevance order when everything is distinct", () => {
    const picked = maximalMarginalRelevance(
      [
        { id: "x", relevance: 0.3, tokens: new Set(["x"]) },
        { id: "y", relevance: 0.8, tokens: new Set(["y"]) },
      ],
      5,
    );
    expect(picked).toEqual(["y", "x"]);
  });
});

describe("ChunkIndex", () => {
  it("retrieves topical chunks and boosts fresh files on ties", () => {
    const index = new ChunkIndex();
    expect(index.query("anything")).toEqual([]);
    index.add([
      { path: "old.md", content: "agent loop design notes", ageRank: 9 },
      { path: "new.md", content: "agent loop design notes", ageRank: 0 },
    ]);
    expect(index.size).toBe(2);
    const hits = index.query("agent loop");
    expect(hits.map((h) => h.path)).toEqual(["new.md", "old.md"]);
  });

  it("enforces caps and clears", () => {
    const index = new ChunkIndex();
    index.add([{ path: "a.md", content: "hello world", ageRank: 0 }]);
    index.clear();
    expect(index.size).toBe(0);
    expect(index.query("hello")).toEqual([]);
  });
});
