/**
 * @file title test
 * @description Locks title normalization, keyword fallback, and the Titler port.
 */
import { describe, expect, it } from "vitest";
import { firstUsableTitle, normalizeTitle } from "../src/normalize.js";
import { extractKeywords, titleFromKeywords, titleFromPrompt, titleSession } from "../src/title.js";

describe("normalizeTitle", () => {
  it("collapses, strips, and caps with ellipsis", () => {
    expect(normalizeTitle("  hello   world  ")).toBe("hello world");
    expect(normalizeTitle('```\nreal title\n```')).toBe("real title");
    expect(normalizeTitle("   ")).toBeNull();
    const long = normalizeTitle("x".repeat(200));
    expect(long!.length).toBeLessThanOrEqual(80);
    expect(long!.endsWith("…")).toBe(true);
    expect(firstUsableTitle(["  ", "second"])).toBe("second");
    expect(firstUsableTitle([])).toBe("Untitled session");
  });
});

describe("extractKeywords", () => {
  it("skips stopwords and short tokens", () => {
    expect(extractKeywords("How to fix the login bug please")).toContain("login");
    expect(extractKeywords("the and of")).toEqual([]);
  });
});

describe("titleSession", () => {
  it("squeezes prompts and falls back deterministically", async () => {
    expect(await titleSession({ question: "  Fix login\nsecond line" })).toBe("Fix login");
    expect(await titleSession({ question: "   " })).toBe("Untitled session");
    expect(await titleSession({ question: "zzz qqq xxx" })).toBe("zzz qqq xxx");
    expect(titleFromKeywords("zzz qqq xxx")).toBe("zzz · qqq · xxx");
    expect(titleFromPrompt("")).toBeNull();
    expect(titleFromKeywords("!!!")).toBeNull();
  });

  it("prefers the Titler port but survives its failure", async () => {
    expect(await titleSession({ question: "q" }, { titler: async () => "  Model Title  " })).toBe("Model Title");
    expect(await titleSession({ question: "Real question" }, { titler: async () => { throw new Error("down"); } })).toBe("Real question");
    expect(await titleSession({ question: "Real question" }, { titler: async () => "   " })).toBe("Real question");
  });
});
