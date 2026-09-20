/**
 * @file caps tests
 * @description Locks readInt absent-signal handling.
 *
 * Responsibilities:
 * - Pin blank/absent/non-finite args fall back (never coerce to misleading zero)
 */

import { describe, expect, it } from "vitest";
import { estimateTokensFromChars } from "@agentprism/contracts";
import { readInt, truncate } from "../../src/definitions/caps.js";

describe("readInt", () => {
  it("falls back on absent, blank, and non-finite inputs", () => {
    expect(readInt({}, "k", 30)).toBe(30);
    expect(readInt({ k: null }, "k", 30)).toBe(30);
    expect(readInt({ k: "" }, "k", 30)).toBe(30);
    expect(readInt({ k: "   " }, "k", 30)).toBe(30);
    expect(readInt({ k: "abc" }, "k", 30)).toBe(30);
    expect(readInt({ k: NaN }, "k", 30)).toBe(30);
  });

  it("keeps explicit numeric coercions (including zero)", () => {
    expect(readInt({ k: 0 }, "k", 30)).toBe(0);
    expect(readInt({ k: 7.9 }, "k", 30)).toBe(7);
    expect(readInt({ k: "12" }, "k", 30)).toBe(12);
  });
});

describe("truncate", () => {
  it("leaves short text untouched", () => {
    expect(truncate("hello", 100)).toBe("hello");
    expect(truncate("x".repeat(100), 100)).toBe("x".repeat(100));
  });

  it("keeps head and tail with a totals marker within budget", () => {
    const text = `HEAD-${"a".repeat(2000)}-TAIL-${"b".repeat(500)}`;
    const out = truncate(text, 1000);
    expect(out.length).toBeLessThanOrEqual(1000);
    expect(out.startsWith("HEAD-")).toBe(true);
    expect(out.endsWith("b".repeat(200))).toBe(true);
    expect(out).toContain("middle pruned");
    expect(out).toContain(`~${estimateTokensFromChars(text.length)} tokens total`);
    expect(out).not.toContain("-TAIL-");
  });

  it("is deterministic for the same input", () => {
    const text = "z".repeat(5000);
    expect(truncate(text, 1000)).toBe(truncate(text, 1000));
  });

  it("falls back to a head cut on degenerate budgets", () => {
    const out = truncate("abcdefghij", 4);
    expect(out.startsWith("abcd")).toBe(true);
    expect(out).toContain("truncated");
  });
});
