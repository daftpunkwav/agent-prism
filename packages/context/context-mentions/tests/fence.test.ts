/**
 * @file fence test
 * @description Locks closing-tag escaping for fenced model-visible blocks.
 *
 * Responsibilities:
 * - Pin case/whitespace/attribute variants of a closing tag to the escaped form
 * - Pin that ordinary text, the opening tag, and other tags stay untouched
 */

import { describe, expect, it } from "vitest";
import { escapeClosingTag } from "../src/fence.js";

/** Matches a close tag the model could read as the block end. */
const CLOSE = /<\/\s*file_mention\b[^>]*>/gi;

describe("escapeClosingTag", () => {
  it("escapes the canonical closing tag by inserting a backslash after '<'", () => {
    expect(escapeClosingTag("before </file_mention> after", "file_mention")).toBe(
      "before <\\/file_mention> after",
    );
  });

  it("escapes uppercase, whitespace, and attribute variants", () => {
    const variants = [
      "</FILE_MENTION>",
      "</File_Mention>",
      "</ file_mention>",
      "</file_mention >",
      "</file_mention\t>",
      "</file_mention\n>",
      "</file_mention foo=\"bar\">",
      "</file_mention data-x='1' >",
    ];
    for (const variant of variants) {
      const escaped = escapeClosingTag(`x ${variant} y`, "file_mention");
      // No raw close-tag match remains; the text is preserved with a backslash.
      expect(escaped.match(CLOSE), variant).toBeNull();
      expect(escaped, variant).toContain("<\\" + variant.slice(1));
    }
  });

  it("escapes every occurrence in one pass", () => {
    const escaped = escapeClosingTag(
      "</file_mention></FILE_MENTION ></file_mention attr>",
      "file_mention",
    );
    expect(escaped.match(CLOSE)).toBeNull();
    expect(escaped.match(/<\\\/file_mention/gi)).toHaveLength(3);
  });

  it("leaves ordinary text, opening tags, and other tags untouched", () => {
    const text = "<file_mention>keep this\nplain </other_tag> </file_mentions> text";
    expect(escapeClosingTag(text, "file_mention")).toBe(text);
  });

  it("returns empty inputs unchanged", () => {
    expect(escapeClosingTag("", "file_mention")).toBe("");
    expect(escapeClosingTag("text", "")).toBe("text");
  });

  it("treats regex metacharacters in the tag name literally", () => {
    expect(escapeClosingTag("</retrieved.doc>", "retrieved.doc")).toBe("<\\/retrieved.doc>");
  });
});
