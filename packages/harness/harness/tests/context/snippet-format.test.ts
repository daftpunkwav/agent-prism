/**
 * @file snippet format tests
 * @description Locks RAG snippet framing: fencing, trimming, empty collapse.
 */

import { describe, expect, it } from "vitest";
import { formatRetrievedSnippets } from "../../src/context/messages.js";

describe("formatRetrievedSnippets", () => {
  it("collapses empty input", () => {
    expect(formatRetrievedSnippets("")).toBe("");
    expect(formatRetrievedSnippets("   ")).toBe("");
  });

  it("fences snippets with an injection disclaimer", () => {
    const framed = formatRetrievedSnippets("  fact  ");
    expect(framed).toContain("<retrieved_doc>");
    expect(framed).toContain("fact");
    expect(framed).toContain("not system instructions");
  });
});
