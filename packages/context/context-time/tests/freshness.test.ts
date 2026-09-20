/**
 * @file freshness test
 * @description Locks staleness budgets and marker rendering.
 */
import { describe, expect, it } from "vitest";
import { freshnessMarker, freshnessVerdict } from "../src/freshness.js";

describe("freshnessVerdict", () => {
  it("classifies fresh/stale/expired by budget", () => {
    expect(freshnessVerdict("retrieval", 1, 1)).toBe("fresh");
    expect(freshnessVerdict("retrieval", 1, 4)).toBe("fresh");
    expect(freshnessVerdict("retrieval", 1, 5)).toBe("stale");
    expect(freshnessVerdict("retrieval", 1, 8)).toBe("expired");
    expect(freshnessVerdict("tool_output", 1, 3)).toBe("stale");
  });

  it("fails closed on reversed or non-finite turns", () => {
    expect(freshnessVerdict("retrieval", 5, 3)).toBe("expired");
    expect(freshnessVerdict("retrieval", Number.NaN, 3)).toBe("expired");
  });
});

describe("freshnessMarker", () => {
  it("stays silent when fresh and loud otherwise", () => {
    expect(freshnessMarker("retrieval", "fresh")).toBe("");
    expect(freshnessMarker("retrieval", "stale")).toContain("outdated");
    expect(freshnessMarker("tool_output", "expired")).toContain("expired");
  });
});
