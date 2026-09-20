/**
 * @file majority-vote test
 * @description Locks exact-match grouping, tie-breaking, and per-answer counts.
 */
import { describe, expect, it } from "vitest";
import { majorityVote } from "../src/majority-vote.js";

describe("majorityVote", () => {
  it("picks the exact-match majority and reports per-answer counts", () => {
    const result = majorityVote(["a", "b", "a"]);
    expect(result.winner).toBe(0);
    expect(result.counts).toEqual([2, 1, 2]);
  });

  it("breaks ties toward the lowest task index", () => {
    const result = majorityVote(["x", "y"]);
    expect(result.winner).toBe(0);
    expect(result.counts).toEqual([1, 1]);
  });

  it("ignores surrounding whitespace when grouping", () => {
    const result = majorityVote(["  done ", "done", "other"]);
    expect(result.winner).toBe(0);
    expect(result.counts).toEqual([2, 2, 1]);
  });

  it("handles the single-answer case", () => {
    const result = majorityVote(["only"]);
    expect(result.winner).toBe(0);
    expect(result.counts).toEqual([1]);
  });
});
