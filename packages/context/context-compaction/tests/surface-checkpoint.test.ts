/**
 * @file surface-checkpoint test
 * @description Locks span selection pair-safety and checkpoint envelopes.
 */
import { describe, expect, it } from "vitest";
import { buildCheckpoint, extractiveFill, parseCheckpoint, renderCheckpoint } from "../src/checkpoint.js";
import { estimateTokens, selectSpan, surfaceTokens, type SurfaceFrame } from "../src/surface.js";

function frame(partial: Partial<SurfaceFrame> & { id: string }): SurfaceFrame {
  return { role: "user", text: "t", weight: 1, compactable: true, ...partial };
}

describe("surface metering", () => {
  it("estimates tokens and totals", () => {
    expect(estimateTokens("")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(surfaceTokens([frame({ id: "a", text: "abcd" })])).toBeGreaterThan(0);
  });
});

describe("selectSpan", () => {
  it("selects the oldest qualifying window and skips pinned frames", () => {
    const frames = [
      frame({ id: "sys", role: "system", text: "s", compactable: false }),
      frame({ id: "u1", text: "hello world, this is a long first question here" }),
      frame({ id: "a1", role: "assistant", text: "working on it now, please wait a moment" }),
      frame({ id: "t1", role: "tool", text: "result payload here", tool: "bash" }),
      frame({ id: "u2", text: "fresh question" }),
    ];
    const span = selectSpan(frames, 10);
    expect(span).not.toBeNull();
    expect(span!.start).toBe(1);
    expect(span!.ids).toContain("u1");
    expect(selectSpan(frames, 0)).toBeNull();
    expect(selectSpan([frame({ id: "p", compactable: false })], 5)).toBeNull();
  });

  it("never starts on a tool frame or ends before its tool result", () => {
    const frames = [
      frame({ id: "t0", role: "tool", text: "orphan result data here", tool: "bash" }),
      frame({ id: "a1", role: "assistant", text: "assistant text without tools here" }),
    ];
    const span = selectSpan(frames, 4);
    // Leading tool frame is unstartable; the assistant-only tail qualifies.
    expect(span === null || span.start).toBe(1);
  });
});

describe("checkpoints", () => {
  const frames = [
    frame({ id: "u1", role: "user", text: "Fix the login bug in src/auth.ts" }),
    frame({ id: "a1", role: "assistant", text: "I called read and run to reproduce" }),
    frame({ id: "t1", role: "tool", text: "ERROR: null pointer\nat src/auth.ts:12", tool: "bash" }),
  ];
  it("fills sections extractively with entities", () => {
    const fill = extractiveFill(frames);
    expect(fill.intent[0]).toContain("login");
    expect(fill.errors.join(" ")).toContain("null pointer");
    expect(fill.files.join(" ")).toContain("src/auth.ts");
    expect(fill.pending).toEqual(["(none)"]);
  });

  it("round-trips through render and parse", async () => {
    const checkpoint = await buildCheckpoint(frames);
    expect(checkpoint.abstractive).toBe(false);
    expect(checkpoint.frameIds).toEqual(["u1", "a1", "t1"]);
    const text = renderCheckpoint(checkpoint);
    expect(text).toContain("<compacted-summary>");
    const parsed = parseCheckpoint(text);
    expect(parsed).not.toBeNull();
    expect(parsed!["errors"].join(" ")).toContain("null pointer");
    expect(parseCheckpoint("garbage")).toBeNull();
    expect(parseCheckpoint("<compacted-summary>\n## bogus\nx\n</compacted-summary>")).toBeNull();
  });

  it("overlays host summarizer prose with extractive fallback", async () => {
    const checkpoint = await buildCheckpoint(frames, {
      summarizer: async () => ({ next: ["Ship the fix"] }),
    });
    expect(checkpoint.abstractive).toBe(true);
    expect(checkpoint.sections["next"]).toEqual(["Ship the fix"]);
    expect(checkpoint.sections["errors"].join(" ")).toContain("null pointer");
    const failed = await buildCheckpoint(frames, {
      summarizer: async () => { throw new Error("down"); },
    });
    expect(failed.abstractive).toBe(true);
    expect(failed.sections["next"]).toEqual(["(none)"]);
  });
});
