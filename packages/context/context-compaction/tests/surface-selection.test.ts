/**
 * @file surface selection tests
 * @description Locks the span-selection ordering and the injectable token divisor.
 *
 * Responsibilities:
 * - Pin weight as the soft protection the frame contract promises
 * - Pin the oldest-first fallback for equally weighted spans
 * - Pin that the divisor can be injected and changes both metering and selection
 * - Pin that content lines looking like structure survive a render/parse round trip
 */

import { describe, expect, it } from "vitest";
import { parseCheckpoint, renderCheckpoint, type Checkpoint } from "../src/checkpoint.js";
import { estimateTokens, selectSpan, surfaceTokens, type SurfaceFrame } from "../src/surface.js";

function frame(partial: Partial<SurfaceFrame> & { id: string }): SurfaceFrame {
  return { role: "user", text: "t", weight: 1, compactable: true, ...partial };
}

/** Long enough to clear a small target on its own. */
const long = "wording that comfortably exceeds the target tokens";

describe("selectSpan ordering", () => {
  it("compacts the least important span before an older heavy one", () => {
    const frames = [
      frame({ id: "heavy", text: long, weight: 10 }),
      frame({ id: "light", text: long, weight: 1 }),
    ];
    const span = selectSpan(frames, 5);
    // Weight is the contract: "higher survives longer", so the light frame goes first
    // even though the heavy one is older.
    expect(span?.ids).toEqual(["light"]);
  });

  it("falls back to the oldest span when weights are equal", () => {
    const frames = [
      frame({ id: "first", text: long }),
      frame({ id: "second", text: long }),
    ];
    const span = selectSpan(frames, 5);
    expect(span?.ids).toEqual(["first"]);
  });

  it("keeps the span as small as the overflow allows", () => {
    const frames = [frame({ id: "a", text: long }), frame({ id: "b", text: long })];
    // A target larger than one frame but smaller than both must pull in the second.
    const span = selectSpan(frames, surfaceTokens(frames) - 1);
    expect(span?.ids).toEqual(["a", "b"]);
  });
});

describe("selectSpan metering divisor", () => {
  it("uses the injected divisor for both metering and the target comparison", () => {
    const frames = [frame({ id: "a", text: "x".repeat(100) })];
    // 100 chars = 25 tokens + 4 overhead at 4 chars/token, 50 + 4 at 2 chars/token.
    expect(selectSpan(frames, 30)).toBeNull();
    expect(selectSpan(frames, 30, { charsPerToken: 2 })?.ids).toEqual(["a"]);
    expect(surfaceTokens(frames, 2)).toBeGreaterThan(surfaceTokens(frames, 4));
    expect(estimateTokens("x".repeat(100), 2)).toBe(50);
  });
});

describe("checkpoint envelope escaping", () => {
  it("round-trips section content that looks like a section head", () => {
    const sections = {
      intent: ["## intent", "keep this line"],
      concepts: ["## files"],
      files: ["(none)"],
      errors: ["## next is not a real head"],
      pending: ["(none)"],
      work: ["(none)"],
      next: ["done"],
    } as Checkpoint["sections"];
    const text = renderCheckpoint({ frameIds: [], sections, abstractive: false });
    const parsed = parseCheckpoint(text);
    expect(parsed).not.toBeNull();
    // Content survives verbatim, and no section was truncated or overwritten.
    expect(parsed!.intent).toEqual(["## intent", "keep this line"]);
    expect(parsed!.concepts).toEqual(["## files"]);
    expect(parsed!.errors).toEqual(["## next is not a real head"]);
    expect(parsed!.next).toEqual(["done"]);
  });

  it("rejects an envelope whose content was not escaped", () => {
    const unescaped = "<compacted-summary>\n## intent\n## files\n## concepts\nx\n</compacted-summary>";
    expect(parseCheckpoint(unescaped)).toBeNull();
  });
});
