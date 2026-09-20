/**
 * @file timestamp-invariant test
 * @description Locks UTC formatting/parsing and stamp guards.
 */
import { describe, expect, it } from "vitest";
import { checkStamp, repairSequence } from "../src/invariant.js";
import { formatUtcDate, formatUtcDateTime, parseUtcDate, parseUtcDateTime, startOfUtcDay, wholeDaysBetween } from "../src/timestamp.js";

describe("timestamps", () => {
  it("formats and round-trips UTC instants", () => {
    expect(formatUtcDate(0)).toBe("unknown date");
    expect(formatUtcDate(Date.UTC(2026, 8, 11))).toBe("2026-09-11 (UTC)");
    expect(formatUtcDateTime(Date.UTC(2026, 8, 11, 8, 30, 5))).toBe("2026-09-11T08:30:05Z");
    expect(parseUtcDate("2026-09-11")).toBe(Date.UTC(2026, 8, 11));
    expect(parseUtcDateTime("2026-09-11T08:30:05Z")).toBe(Date.UTC(2026, 8, 11, 8, 30, 5));
  });

  it("rejects malformed and impossible dates", () => {
    expect(parseUtcDate("2026-13-01")).toBeNaN();
    expect(parseUtcDate("tomorrow")).toBeNaN();
    expect(parseUtcDateTime("2026-09-11 08:30:05")).toBeNaN();
  });

  it("computes day boundaries and spans", () => {
    const noon = Date.UTC(2026, 8, 11, 12);
    expect(startOfUtcDay(noon)).toBe(Date.UTC(2026, 8, 11));
    expect(wholeDaysBetween(Date.UTC(2026, 8, 10), noon)).toBe(1);
    expect(wholeDaysBetween(noon, Date.UTC(2026, 8, 10))).toBe(-1);
  });
});

describe("stamp guards", () => {
  it("passes clean stamps and clamps backward/skewed ones", () => {
    expect(checkStamp(null, 100)).toMatchObject({ stamp: 100, corrected: false });
    expect(checkStamp(100, 200)).toMatchObject({ corrected: false });
    expect(checkStamp(200, 150)).toMatchObject({ stamp: 200, corrected: true, reason: "backward" });
    const skewed = checkStamp(0, 10_000_000);
    expect(skewed).toMatchObject({ corrected: true, reason: "skew" });
    expect(checkStamp(50, Number.NaN)).toMatchObject({ corrected: true });
  });

  it("repairs sequences and counts corrections", () => {
    const { stamps, corrections } = repairSequence([10, 20, 15, 30]);
    expect(stamps).toEqual([10, 20, 20, 30]);
    expect(corrections).toBe(1);
    expect(repairSequence([])).toEqual({ stamps: [], corrections: 0 });
  });
});
