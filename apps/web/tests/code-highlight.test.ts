// @vitest-environment jsdom
/**
 * @file code highlight tests
 * @description Locks the preview tokenizer: extension mapping, token kinds, plain-text fallback.
 */

import { describe, expect, it } from "vitest";
import { languageOfPath, tokenizeCode } from "../src/components/codeHighlight.js";

/** Joins the tokenized text back together; tokenization must never lose characters. */
function joined(text: string, language: string): string {
  return tokenizeCode(text, language)
    .map((token) => token.text)
    .join("");
}

/** Collects the kinds of tokens whose text contains the given fragment. */
function kindOf(text: string, language: string, fragment: string): string | null {
  const hit = tokenizeCode(text, language).find(
    (token) => token.kind !== null && token.text.includes(fragment),
  );
  return hit?.kind ?? null;
}

describe("languageOfPath", () => {
  it("maps extensions onto the supported language set", () => {
    expect(languageOfPath("src/main.py")).toBe("py");
    expect(languageOfPath("app.tsx")).toBe("tsx");
    expect(languageOfPath("data/config.yml")).toBe("yml");
    expect(languageOfPath("run.log")).toBe("");
    expect(languageOfPath("Dockerfile")).toBe("");
  });
});

describe("tokenizeCode", () => {
  it("keeps plain text as one token for unknown languages", () => {
    expect(tokenizeCode("just text", "")).toEqual([{ text: "just text", kind: null }]);
  });

  it("never loses characters while tokenizing", () => {
    const sample = 'def greet(name):\n    # say hi\n    return f"hello {name}"';
    expect(joined(sample, "py")).toBe(sample);
    expect(joined('const x = { a: 1 }; // set', "ts")).toBe('const x = { a: 1 }; // set');
  });

  it("classifies python comments, strings, numbers, and keywords", () => {
    const sample = '# heading\ndef run(steps=10):\n    return "done"';
    expect(kindOf(sample, "py", "# heading")).toBe("comment");
    expect(kindOf(sample, "py", "def")).toBe("keyword");
    expect(kindOf(sample, "py", "10")).toBe("number");
    expect(kindOf(sample, "py", '"done"')).toBe("string");
  });

  it("classifies js/ts comments and template literals", () => {
    const sample = "/* block */\nconst name = `hi ${1}`;";
    expect(kindOf(sample, "ts", "/* block */")).toBe("comment");
    expect(kindOf(sample, "ts", "`hi ${1}`")).toBe("string");
    expect(kindOf(sample, "ts", "const")).toBe("keyword");
  });

  it("classifies json literals and shell comments", () => {
    expect(kindOf('{"k": true}', "json", "true")).toBe("keyword");
    expect(kindOf('{"k": 42}', "json", "42")).toBe("number");
    expect(kindOf('echo hi # run\nif true; then :; fi', "sh", "# run")).toBe("comment");
    expect(kindOf('echo hi # run\nif true; then :; fi', "sh", "if")).toBe("keyword");
  });

  it("classifies markdown headings and fenced blocks", () => {
    const sample = "# Title\n```py\nx = 1\n```\nText";
    expect(kindOf(sample, "md", "# Title")).toBe("keyword");
    expect(kindOf(sample, "md", "```py")).toBe("string");
  });

  it("classifies yaml comments and css at-rules", () => {
    expect(kindOf("key: value # note", "yml", "# note")).toBe("comment");
    expect(kindOf("@media (min-width: 1px) { }", "css", "@media")).toBe("keyword");
  });
});
