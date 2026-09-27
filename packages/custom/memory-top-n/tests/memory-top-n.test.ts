/**
 * @file memory-top-n tests
 * @description Locks the memory-top-n dimension: limit resolution, recall
 * truncation, and the descriptor shape.
 */

import { describe, expect, it } from "vitest";
import type { MemoryRecallResult } from "@agentprism/contracts";
import { memoryLimitsFor, memoryTopNDimension } from "../src/index.js";

function recall(episodicCount: number, semanticCount: number): MemoryRecallResult {
  return {
    episodic: Array.from({ length: episodicCount }, (_, i) => ({
      id: `e${i}`,
      task: `task ${i}`,
      framework: "native",
      model: "test-model",
      success: true,
      keyActions: [],
      lessons: "",
      timestamp: 0,
      workspaceTag: "",
    })),
    semantic: Array.from({ length: semanticCount }, (_, i) => ({
      id: `s${i}`,
      subject: `subject ${i}`,
      predicate: "is",
      object: "x",
      confidence: 1,
      validFrom: 0,
      source: "test",
    })),
  };
}

describe("memoryLimitsFor", () => {
  it("maps top-N values to matching caps on both layers", () => {
    expect(memoryLimitsFor("top3")).toEqual({ episodic: 3, semantic: 3 });
    expect(memoryLimitsFor("top10")).toEqual({ episodic: 10, semantic: 10 });
  });

  it("removes the caps entirely for the all-recalled value", () => {
    const limits = memoryLimitsFor("all");
    expect(limits?.episodic).toBeGreaterThan(1000);
    expect(limits?.semantic).toBeGreaterThan(1000);
  });

  it("returns null for an unknown value (no shaping)", () => {
    expect(memoryLimitsFor("top99")).toBeNull();
  });
});

describe("memoryTopNDimension", () => {
  it("declares the three depths with a declared default", () => {
    expect(memoryTopNDimension.id).toBe("memory_top_n");
    expect(memoryTopNDimension.options.map((option) => option.value)).toEqual(["top3", "top10", "all"]);
    expect(memoryTopNDimension.default).toBe("top3");
  });

  it("truncates both layers for a top-N choice", () => {
    const hook = memoryTopNDimension.hooks?.memory;
    if (hook === undefined) throw new Error("memory-top-n must expose a memory hook");
    const shaped = hook({ recall: recall(12, 9), limits: { episodic: 3, semantic: 5 }, context: { question: "", custom: {} } }, "top10");
    expect(shaped?.recall?.episodic).toHaveLength(10);
    expect(shaped?.recall?.semantic).toHaveLength(9);
    expect(shaped?.limits).toEqual({ episodic: 10, semantic: 10 });
  });

  it("keeps the recall intact but raises the caps for all-recalled", () => {
    const hook = memoryTopNDimension.hooks?.memory;
    if (hook === undefined) throw new Error("memory-top-n must expose a memory hook");
    const full = recall(12, 9);
    const shaped = hook({ recall: full, limits: { episodic: 3, semantic: 5 }, context: { question: "", custom: {} } }, "all");
    expect(shaped?.recall).toBe(full);
    expect(shaped?.limits?.episodic).toBeGreaterThan(12);
  });

  it("leaves an absent recall absent", () => {
    const hook = memoryTopNDimension.hooks?.memory;
    if (hook === undefined) throw new Error("memory-top-n must expose a memory hook");
    const shaped = hook({ recall: undefined, limits: { episodic: 3, semantic: 5 }, context: { question: "", custom: {} } }, "top3");
    expect(shaped?.recall).toBeUndefined();
    expect(shaped?.limits).toEqual({ episodic: 3, semantic: 3 });
  });
});
