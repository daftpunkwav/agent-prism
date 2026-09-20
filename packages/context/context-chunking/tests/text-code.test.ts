/**
 * @file text-code test
 * @description Locks text overlap chunking and code block splitting.
 */
import { describe, expect, it } from "vitest";
import { chunkText } from "../src/text.js";
import { chunkCode } from "../src/code.js";

describe("chunkText", () => {
  it("returns single chunks for short text and none for empty", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("hi", { maxChars: 200 })).toHaveLength(1);
  });

  it("splits CJK sentences and overlaps neighbors", () => {
    const text = `第一句内容在这里。第二句内容在这里！第三句内容在这里？${"x".repeat(300)}`;
    const chunks = chunkText(text, { maxChars: 200, overlap: 40 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.content.length <= 240)).toBe(true);
    expect(chunks[1]!.start).toBeLessThan(chunks[0]!.end);
    // Coverage invariants: first chunk opens the text, last chunk closes it.
    expect(chunks[0]!.start).toBe(0);
    expect(chunks[chunks.length - 1]!.end).toBeGreaterThanOrEqual(text.length - 1);
    expect(chunks.every((c) => c.content.trim() !== "")).toBe(true);
  });
});

describe("chunkCode", () => {
  const src = `import os\n\nCONST = 1\n\ndef alpha():\n    x = 1\n    return x\n\nclass Beta:\n    def method(self):\n        return 2\n`;
  it("splits on definitions with symbols and line numbers", () => {
    const chunks = chunkCode(src);
    const symbols = chunks.map((c) => c.symbol);
    expect(symbols).toContain("alpha");
    expect(symbols).toContain("Beta");
    expect(chunks[0]!.startLine).toBe(1);
    for (const chunk of chunks) {
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
    }
  });

  it("windows over-long blocks with overlap", () => {
    const big = `def huge():\n${Array.from({ length: 200 }, (_, i) => `    line_${i} = ${i}`).join("\n")}\n`;
    const chunks = chunkCode(big, { maxLines: 50, overlapLines: 10 });
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.kind === "window")).toBe(true);
    expect(chunks[1]!.startLine).toBeLessThan(chunks[0]!.endLine);
  });

  it("returns nothing for blank input", () => {
    expect(chunkCode("   \n  ")).toEqual([]);
  });
});
