/**
 * @file markdown-router test
 * @description Locks header-hierarchy markdown chunking and the file router.
 */
import { describe, expect, it } from "vitest";
import { chunkMarkdown } from "../src/markdown.js";
import { chunkFile } from "../src/chunk.js";

describe("chunkMarkdown", () => {
  it("keeps section paths on chunks", () => {
    const doc = `# Guide\nintro\n\n## Context\nbody here\n\n## Other\nmore\n`;
    const chunks = chunkMarkdown(doc);
    expect(chunks.length).toBe(3);
    expect(chunks[1]).toMatchObject({ section: "Guide > Context" });
  });

  it("reports a line start for every chunk of a multi-chunk document", () => {
    const lines = ["# T", ...Array.from({ length: 40 }, (_v, i) => `line ${i} with some words`)];
    const doc = `${lines.join("\n")}\n`;
    const chunks = chunkMarkdown(doc, { maxChars: 120 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // A character offset would point into the middle of a line; the citation the
      // model receives must name a real line.
      expect(chunk.startLine).toBeGreaterThanOrEqual(1);
      expect(lines[chunk.startLine - 1]).toBeDefined();
      expect(chunk.content.length).toBeGreaterThan(0);
    }
  });

  it("never splits fenced code blocks", () => {
    const doc = `# A\n${"x".repeat(900)}\n\`\`\`python\n${"y = 1\n".repeat(200)}\n\`\`\`\n`;
    const chunks = chunkMarkdown(doc, { maxChars: 500 });
    for (const chunk of chunks) {
      const fences = (chunk.content.match(/```/g) ?? []).length;
      expect(fences % 2).toBe(0);
    }
  });
});

describe("chunkFile", () => {
  it("routes by extension with locations", () => {
    const md = chunkFile("docs/a.md", "# T\nhello\n");
    expect(md[0]).toMatchObject({ path: "docs/a.md", language: "md" });
    const ts = chunkFile("src/a.ts", "export function f(): void {}\n");
    expect(ts[0]).toMatchObject({ language: "ts" });
    expect(ts[0]!.location).toMatch(/^L\d+/);
    const txt = chunkFile("notes.txt", "plain words here");
    expect(txt[0]).toMatchObject({ language: "txt", context: null });
    expect(chunkFile("empty.ts", "  ")).toEqual([]);
  });
});
