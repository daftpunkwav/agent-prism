/**
 * @file bounded read seam tests
 * @description Locks the symbol loader's bounded read and its legacy fallback.
 *
 * Responsibilities:
 * - Pin that a host offering `readFileHead` is read through the byte cap
 * - Pin that a host without it still gets the post-slice fallback
 */

import { describe, expect, it, vi } from "vitest";
import { readBounded } from "../src/tool.js";

describe("readBounded", () => {
  it("prefers the host's bounded head read", () => {
    const readFileHead = vi.fn(() => ({ text: "head", truncated: true }));
    const readFile = vi.fn(() => "full".repeat(1000));
    const text = readBounded({ readFile, listFiles: () => [], readFileHead } as never, "a.ts", 4);
    expect(text).toBe("head");
    expect(readFileHead).toHaveBeenCalledWith("a.ts", 4);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("falls back to a post-slice when the host cannot bound the read", () => {
    const readFile = vi.fn(() => "abcdef");
    expect(readBounded({ readFile, listFiles: () => [] } as never, "a.ts", 3)).toBe("abc");
  });
});
