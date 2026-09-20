/**
 * @file grammar test
 * @description Locks `@file` mention parsing, formatting, and validation.
 */
import { describe, expect, it } from "vitest";
import { formatMention, isResolvableMentionPath, parseMentions } from "../src/grammar.js";

describe("parseMentions", () => {
  it("extracts plain and quoted mentions in order", () => {
    const mentions = parseMentions('see @src/a.ts and @"my docs/b.md" now');
    expect(mentions.map((m) => m.path)).toEqual(["src/a.ts", "my docs/b.md"]);
    expect(mentions[0]).toMatchObject({ quoted: false });
    expect(mentions[1]).toMatchObject({ quoted: true });
    expect(mentions[0]!.start).toBe(4);
  });

  it("ignores emails, decorators, and bare @ signs", () => {
    expect(parseMentions("mail me at a@b.com")).toEqual([]);
    expect(parseMentions("@decorator\n@")).toHaveLength(1);
    expect(parseMentions("@")).toEqual([]);
  });

  it("strips trailing prose punctuation", () => {
    const mentions = parseMentions("open @src/a.ts, then @b.ts.");
    expect(mentions.map((m) => m.path)).toEqual(["src/a.ts", "b.ts"]);
  });
});

describe("formatMention", () => {
  it("quotes only when needed", () => {
    expect(formatMention("a.ts")).toBe("@a.ts");
    expect(formatMention("my docs/b.md")).toBe('@"my docs/b.md"');
    expect(formatMention("a.ts", { forceQuote: true })).toBe('@"a.ts"');
    expect(formatMention("  ")).toBeNull();
  });
});

describe("isResolvableMentionPath", () => {
  it("rejects absolute paths, traversal, and backslashes", () => {
    expect(isResolvableMentionPath("src/a.ts")).toBe(true);
    expect(isResolvableMentionPath("/etc/passwd")).toBe(false);
    expect(isResolvableMentionPath("../evil")).toBe(false);
    expect(isResolvableMentionPath("a\\b")).toBe(false);
    expect(isResolvableMentionPath("")).toBe(false);
  });
});
