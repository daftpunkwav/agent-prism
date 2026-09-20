/**
 * @file content utilities tests
 * @description Locks text extraction, tool-call normalization, and chunk splitting.
 */

import { describe, expect, it } from "vitest";
import {
  extractChunkParts,
  normalizeToolCalls,
  textFromContent,
} from "@agentprism/contracts";

describe("content utilities single source", () => {
  it("textFromContent keeps any string text and stringifies the rest", () => {
    expect(textFromContent("hi")).toBe("hi");
    expect(textFromContent([{ type: "text", text: "a" }, { type: "other", text: "b" }])).toBe("ab");
    expect(textFromContent(null)).toBe("");
    expect(textFromContent(42)).toBe("42");
  });

  it("normalizeToolCalls drops nameless entries and defaults ids, never undefined", () => {
    expect(normalizeToolCalls("nope")).toEqual([]);
    expect(
      normalizeToolCalls([{ name: "", id: "x", args: {} }, { name: "read", args: { path: "a" } }]),
    ).toEqual([{ id: "call_0", name: "read", args: { path: "a" } }]);
  });

  it("extractChunkParts splits thinking from text", () => {
    expect(extractChunkParts("hello")).toEqual({ thinking: "", text: "hello" });
    expect(extractChunkParts(null)).toEqual({ thinking: "", text: "" });
    expect(
      extractChunkParts({ content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "hi" }] }),
    ).toEqual({ thinking: "hmm", text: "hi" });
  });

  it("textFromContent joins array blocks across shapes (null stringifies too)", () => {
    expect(textFromContent(["a", 42, { text: "b" }, { noText: true }])).toBe("a42b");
    expect(textFromContent(["x", null])).toBe("xnull");
  });

  it("normalizeToolCalls skips junk entries and defaults non-object args", () => {
    expect(
      normalizeToolCalls([42, null, { name: "read", args: "not-object" }, { name: "grep", args: { pattern: "x" } }]),
    ).toEqual([
      { id: "call_0", name: "read", args: {} },
      { id: "call_1", name: "grep", args: { pattern: "x" } },
    ]);
    expect(normalizeToolCalls(undefined)).toEqual([]);
  });

  it("extractChunkParts covers the full vendor block matrix", () => {
    // Anthropic reasoning variants and non-payload blocks.
    expect(
      extractChunkParts({
        content: [
          { type: "reasoning", thinking: "r1" },
          { type: "redacted_thinking", text: "r2" },
          { type: "tool_use", name: "read" },
          { type: "tool_call" },
          { type: "input_json_delta" },
          "plain",
          { type: "text", text: "t1" },
          { type: "mystery", text: "kept" },
        ],
      }),
    ).toEqual({ thinking: "r1r2", text: "plaint1kept" });
    // Non-array non-string content stringifies; array string blocks concatenate.
    expect(extractChunkParts({ content: 42 })).toEqual({ thinking: "", text: "42" });
    expect(extractChunkParts({ content: ["a", "b"] })).toEqual({ thinking: "", text: "ab" });
    // OpenAI-style top-level text payload.
    expect(extractChunkParts({ text: "top-level" })).toEqual({ thinking: "", text: "top-level" });
  });
});
