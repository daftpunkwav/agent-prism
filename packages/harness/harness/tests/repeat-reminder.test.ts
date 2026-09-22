/**
 * @file repeat-reminder test
 * @description Locks repeat detection thresholds, resets, and pattern filters.
 */
import { describe, expect, it } from "vitest";
import { canonicalArgsKey, matchToolPattern, RepeatTracker } from "../src/control/repeat-reminder.js";

describe("matchToolPattern", () => {
  it("supports wildcards with * matching everything", () => {
    expect(matchToolPattern("*", "bash")).toBe(true);
    expect(matchToolPattern("mcp_*", "mcp__fs_read")).toBe(true);
    expect(matchToolPattern("mcp_*", "bash")).toBe(false);
    expect(matchToolPattern("read", "read")).toBe(true);
  });
});

describe("canonicalArgsKey", () => {
  it("orders keys stably", () => {
    expect(canonicalArgsKey({ b: 1, a: 2 })).toBe(canonicalArgsKey({ a: 2, b: 1 }));
    expect(canonicalArgsKey({ a: 1 })).not.toBe(canonicalArgsKey({ a: 2 }));
  });
});

describe("RepeatTracker", () => {
  it("fires at each threshold once per streak", () => {
    const tracker = new RepeatTracker({ thresholds: [2, 3] });
    expect(tracker.record("read", { path: "a" })).toBeNull();
    const first = tracker.record("read", { path: "a" });
    expect(first!).toContain("2x in a row");
    expect(tracker.record("read", { path: "a" })!).toContain("3x in a row");
    expect(tracker.record("read", { path: "a" })).toBeNull();
  });

  it("resets on different tools or args", () => {
    const tracker = new RepeatTracker({ thresholds: [2] });
    expect(tracker.record("read", { path: "a" })).toBeNull();
    expect(tracker.record("read", { path: "b" })).toBeNull();
    expect(tracker.record("read", { path: "b" })).toContain("2x");
    expect(tracker.record("bash", { cmd: "ls" })).toBeNull();
  });

  it("honors include/exclude patterns and rejects bad thresholds", () => {
    const tracker = new RepeatTracker({ thresholds: [2], exclude: ["mcp_*"] });
    expect(tracker.record("mcp__fs_read", {})).toBeNull();
    expect(tracker.record("mcp__fs_read", {})).toBeNull();
    expect(() => new RepeatTracker({ thresholds: [1] })).toThrow();
    expect(() => new RepeatTracker({ thresholds: [] })).toThrow();
  });
});
