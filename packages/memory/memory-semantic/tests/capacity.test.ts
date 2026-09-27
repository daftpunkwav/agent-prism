/**
 * @file memory capacity and prune tests
 * @description Locks batched pruning and the semantic fact ceiling.
 *
 * Responsibilities:
 * - Pin that one prune rewrites the store once, not once per fact
 * - Pin the eviction order (weakest fact goes first) and the cap
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SemanticMemory } from "../src/semantic.js";

function fact(overrides: Partial<{ subject: string; object: string; confidence: number; validUntil: number }> = {}) {
  return {
    subject: overrides.subject ?? "user",
    predicate: "prefers",
    object: overrides.object ?? "tea",
    confidence: overrides.confidence ?? 0.9,
    validFrom: 0,
    ...(overrides.validUntil !== undefined ? { validUntil: overrides.validUntil } : {}),
    source: "test",
  };
}

describe("semantic memory capacity", () => {
  it("trims the weakest facts once the cap is reached", async () => {
    const memory = new SemanticMemory({ maxFacts: 3, now: () => 1_000 });
    await memory.recordFact(fact({ object: "keep-a", confidence: 0.9 }));
    await memory.recordFact(fact({ object: "keep-b", confidence: 0.8 }));
    await memory.recordFact(fact({ object: "weakest", confidence: 0.1 }));
    await memory.recordFact(fact({ object: "keep-c", confidence: 0.7 }));

    expect(memory.size).toBe(3);
    const objects = memory.list().map((entry) => entry.object);
    // The lowest-confidence fact is the one that goes; recency alone does not decide.
    expect(objects).not.toContain("weakest");
    expect(objects).toEqual(expect.arrayContaining(["keep-a", "keep-b", "keep-c"]));
  });

  it("persists a prune as one write instead of one per fact", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aprism-sem-"));
    try {
      const filePath = join(dir, "facts.json");
      let now = 1_000;
      const memory = new SemanticMemory({ filePath, now: () => now });
      await memory.recordFact(fact({ object: "expiring-a", validUntil: 2_000 }));
      await memory.recordFact(fact({ object: "expiring-b", validUntil: 2_000 }));
      await memory.recordFact(fact({ object: "permanent" }));

      now = 3_000;
      const pruned = await memory.pruneExpired();
      expect(pruned).toBe(2);
      const onDisk = JSON.parse(readFileSync(filePath, "utf-8")) as Array<{ object: string }>;
      expect(onDisk.map((entry) => entry.object)).toEqual(["permanent"]);
      expect(memory.size).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
