/**
 * @file builder block board tests
 * @description Verifies numeric field coercion logic in BlockBoard.
 */

import { describe, expect, it } from "vitest";
import { finiteOr } from "../src/app/builder/BlockBoard";

describe("BlockBoard finiteOr", () => {
  it("returns fallback for empty or whitespace strings instead of coercing to 0", () => {
    expect(finiteOr("", 16)).toBe(16);
    expect(finiteOr("   ", 16)).toBe(16);
    expect(finiteOr("\t\n", 8192)).toBe(8192);
  });

  it("returns parsed finite numbers for valid numeric inputs", () => {
    expect(finiteOr("10", 16)).toBe(10);
    expect(finiteOr("0", 16)).toBe(0);
    expect(finiteOr("4096", 8192)).toBe(4096);
  });

  it("returns fallback for NaN or invalid characters", () => {
    expect(finiteOr("abc", 16)).toBe(16);
    expect(finiteOr("12abc", 16)).toBe(16);
    expect(finiteOr("Infinity", 16)).toBe(16);
  });
});
