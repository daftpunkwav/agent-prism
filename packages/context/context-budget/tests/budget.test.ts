/**
 * @file budget test
 * @description Locks weight normalization, priority allocation, and ledgers.
 */
import { describe, expect, it } from "vitest";
import { allocateBudget } from "../src/allocate.js";
import { renderBudgetLedger } from "../src/ledger.js";
import { normalizeWeights } from "../src/sources.js";

describe("normalizeWeights", () => {
  it("normalizes to shares summing to 1 and rejects broken tables", () => {
    const shares = normalizeWeights({ system: 3, tools: 1 });
    const total = Object.values(shares).reduce((sum, share) => sum + share, 0);
    expect(total).toBeCloseTo(1);
    expect(shares.system).toBeGreaterThan(shares.retrieval!);
    expect(() => normalizeWeights({ system: 0, tools: 0, history: 0, instructions: 0, retrieval: 0, mentions: 0, skills: 0 })).toThrow();
    expect(() => normalizeWeights({ system: Number.NaN })).toThrow();
  });
});

describe("allocateBudget", () => {
  it("spends by priority with cascade and reports deficits", () => {
    const result = allocateBudget(100, { system: 40, tools: 90, retrieval: 50 });
    expect(result.spent).toBeLessThanOrEqual(100);
    expect(result.totalDeficit).toBeGreaterThan(0);
    const tools = result.allowances.find((a) => a.source === "tools")!;
    expect(tools.deficit).toBeGreaterThanOrEqual(0);
    expect(tools.granted + tools.deficit).toBe(tools.demanded);
  });

  it("grants full demand when the budget holds", () => {
    const result = allocateBudget(1000, { system: 40, tools: 90 });
    expect(result.totalDeficit).toBe(0);
    expect(result.spent).toBe(130);
    expect(renderBudgetLedger(result)).toBe("");
  });

  it("rejects negative budgets", () => {
    expect(() => allocateBudget(-1, {})).toThrow();
  });
});

describe("renderBudgetLedger", () => {
  it("names exactly what was cut", () => {
    const result = allocateBudget(10, { system: 8, tools: 50 });
    const ledger = renderBudgetLedger(result);
    expect(ledger).toContain("[Budget ledger]");
    expect(ledger).toContain("tools");
  });
});
