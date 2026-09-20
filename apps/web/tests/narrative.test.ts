/**
 * @file narrative tests
 * @description Covers the comparison-narrative parsing helpers.
 *
 * Responsibilities:
 * - Pin [Ablation] suffix splitting, including no-marker and marker-first edges
 * - Pin legacy JSON content-block recovery and its raw-text fallbacks
 */

import { describe, expect, it } from "vitest";
import { cleanNarrativeBody, splitNarrative } from "../src/app/arena/narrative";

describe("splitNarrative", () => {
  it("returns the whole trimmed text as body when no [Ablation] marker exists", () => {
    expect(splitNarrative("  prose only  ")).toEqual({ body: "prose only", ablation: "" });
  });

  it("splits body from the [Ablation] grounding suffix and trims both sides", () => {
    expect(splitNarrative("story prose\n\n[Ablation]  delta: +2 tokens  ")).toEqual({
      body: "story prose",
      ablation: "delta: +2 tokens",
    });
  });

  it("handles a narrative that starts with the marker", () => {
    expect(splitNarrative("[Ablation] grounding only")).toEqual({ body: "", ablation: "grounding only" });
  });
});

describe("cleanNarrativeBody", () => {
  it("leaves plain prose untouched", () => {
    expect(cleanNarrativeBody("already prose")).toBe("already prose");
  });

  it("recovers text blocks from a legacy JSON content-block array and skips textless thinking blocks", () => {
    const legacy = JSON.stringify([
      { type: "thinking" },
      { type: "text", text: "first" },
      { type: "redacted_thinking" },
      { type: "text", text: "second" },
    ]);
    expect(cleanNarrativeBody(legacy)).toBe("first\n\nsecond");
  });

  it("keeps text blocks verbatim (no trimming) while dropping whitespace-only ones", () => {
    expect(cleanNarrativeBody(JSON.stringify([{ type: "text", text: " padded " }]))).toBe(" padded ");
  });

  it("joins legacy plain-string blocks and drops blank ones", () => {
    expect(cleanNarrativeBody(JSON.stringify(["one", "  ", "two"]))).toBe("one\n\ntwo");
  });

  it("recovers a single legacy JSON object (not just arrays)", () => {
    expect(cleanNarrativeBody(JSON.stringify({ type: "text", text: "solo" }))).toBe("solo");
  });

  it("returns the raw body when the JSON-ish text is unparseable", () => {
    expect(cleanNarrativeBody("[not json")).toBe("[not json");
  });

  it("returns the raw body when no block carries usable text", () => {
    expect(cleanNarrativeBody(JSON.stringify([{ type: "text" }]))).toBe(JSON.stringify([{ type: "text" }]));
  });
});

describe("splitNarrative + cleanNarrativeBody", () => {
  it("cleans a legacy body extracted from a narrative with an [Ablation] suffix", () => {
    const narrative = `${JSON.stringify([{ type: "text", text: "the story" }])}\n[Ablation] +3 tokens`;
    const { body, ablation } = splitNarrative(narrative);
    expect(cleanNarrativeBody(body)).toBe("the story");
    expect(ablation).toBe("+3 tokens");
  });
});
