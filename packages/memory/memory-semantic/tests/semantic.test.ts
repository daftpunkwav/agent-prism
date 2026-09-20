/**
 * @file semantic tests
 * @description Locks fact updates, relevance recall, and TTL expiry.
 */

import { describe, expect, it } from "vitest";
import { isFactEffective, SemanticMemory } from "../src/semantic.js";

describe("isFactEffective", () => {
  it("treats missing or zero validUntil as indefinite", () => {
    expect(isFactEffective({ id: "a", subject: "s", predicate: "p", object: "o", confidence: 1, validFrom: 0, source: "" }, 999)).toBe(true);
    expect(
      isFactEffective({ id: "b", subject: "s", predicate: "p", object: "o", confidence: 1, validFrom: 0, validUntil: 0, source: "" }, 999),
    ).toBe(true);
  });

  it("rejects not-yet-effective and expired facts", () => {
    expect(
      isFactEffective({ id: "c", subject: "s", predicate: "p", object: "o", confidence: 1, validFrom: 200, source: "" }, 100),
    ).toBe(false);
    expect(
      isFactEffective({ id: "d", subject: "s", predicate: "p", object: "o", confidence: 1, validFrom: 0, validUntil: 100, source: "" }, 100),
    ).toBe(false);
  });
});

describe("SemanticMemory", () => {
  it("updates the same triple instead of duplicating", async () => {
    const mem = new SemanticMemory({ now: () => 1000 });
    await mem.recordFact({ subject: "project", predicate: "uses", object: "pnpm", confidence: 0.6, validFrom: 0, source: "a" });
    await mem.recordFact({ subject: " Project ", predicate: "USES", object: "pnpm", confidence: 0.9, validFrom: 0, source: "b" });
    expect(mem.size).toBe(1);
    expect(mem.list()[0]?.confidence).toBe(0.9);
  });

  it("recalls relevant facts and hides expired ones", async () => {
    const mem = new SemanticMemory({ now: () => 1000 });
    await mem.recordFact({ subject: "project", predicate: "uses", object: "vitest", confidence: 0.9, validFrom: 0, source: "" });
    await mem.recordFact({ subject: "project", predicate: "uses", object: "npm", confidence: 0.9, validFrom: 0, validUntil: 500, source: "" });
    const hits = await mem.recallFacts("which test runner does the project use");
    expect(hits.map((f) => f.object)).toContain("vitest");
    expect(hits.map((f) => f.object)).not.toContain("npm");
  });

  it("prunes expired facts on write", async () => {
    let now = 1000;
    const mem = new SemanticMemory({ now: () => now });
    await mem.recordFact({ subject: "temp", predicate: "is", object: "old", confidence: 1, validFrom: 0, validUntil: 1500, source: "" });
    now = 2000;
    await mem.recordFact({ subject: "fresh", predicate: "is", object: "new", confidence: 1, validFrom: 0, source: "" });
    expect(mem.list().map((f) => f.object)).toEqual(["new"]);
  });

  it("returns top-confidence facts for empty queries", async () => {
    const mem = new SemanticMemory({ now: () => 1000 });
    await mem.recordFact({ subject: "a", predicate: "is", object: "low", confidence: 0.2, validFrom: 0, source: "" });
    await mem.recordFact({ subject: "b", predicate: "is", object: "high", confidence: 0.95, validFrom: 0, source: "" });
    const hits = await mem.recallFacts("   ", { limit: 1 });
    expect(hits[0]?.object).toBe("high");
  });
});
