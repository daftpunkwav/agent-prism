/**
 * @file workspace segment tests
 * @description Locks the path-safe workspace segment single source.
 */

import { describe, expect, it } from "vitest";
import {
  isSafeWorkspaceSegment,
  safeLogStem,
} from "@agentprism/contracts";

describe("isSafeWorkspaceSegment single source", () => {
  it("accepts path-safe segments and rejects traversal", () => {
    expect(isSafeWorkspaceSegment("ok_name_1")).toBe(true);
    expect(isSafeWorkspaceSegment("Native_1700000000000_a1b2c3")).toBe(true);
    expect(isSafeWorkspaceSegment("")).toBe(false);
    expect(isSafeWorkspaceSegment(".")).toBe(false);
    expect(isSafeWorkspaceSegment("..")).toBe(false);
    expect(isSafeWorkspaceSegment("../../evil")).toBe(false);
    expect(isSafeWorkspaceSegment("a/b")).toBe(false);
    expect(isSafeWorkspaceSegment("a\\b")).toBe(false);
    expect(isSafeWorkspaceSegment("x".repeat(97))).toBe(false);
  });
});

describe("safeLogStem edge cases", () => {
  /** Every stem must stay a single path-safe segment usable as a file name on disk. */
  function expectSafeStem(label: string): string {
    const stem = safeLogStem(label);
    expect(isSafeWorkspaceSegment(stem)).toBe(true);
    expect(stem).not.toContain("/");
    expect(stem).not.toContain("\\");
    return stem;
  }

  it("passes safe labels through unchanged, including Unicode and case", () => {
    expect(safeLogStem("CoT_Tool")).toBe("CoT_Tool");
    expect(safeLogStem("温度-1")).toBe("温度-1");
    expect(safeLogStem("GPT")).toBe("GPT");
    // Modern Windows accepts suffixed device names ("con.events.jsonl" creates fine);
    // the passthrough is the documented contract, not an accident.
    expect(safeLogStem("con")).toBe("con");
  });

  it("collapses unsafe character runs to single underscores", () => {
    expect(safeLogStem("CoT / Tool: v2")).toBe("CoT_Tool_v2");
    expect(safeLogStem("  padded  ")).toBe("padded");
  });

  it("falls back to a deterministic FNV hash when nothing safe survives", () => {
    // FNV-1a of the empty string is its offset basis — stable by construction.
    expect(safeLogStem("")).toBe("column_811c9dc5");
    expect(safeLogStem("###")).toBe("column_ddbab000");
    expect(safeLogStem("🚀🚀")).toBe("column_bf27aa8d");
    expect(expectSafeStem("###")).toBe(expectSafeStem("###"));
    expect(expectSafeStem("###")).not.toBe(expectSafeStem("%%%"));
  });

  it("hash-falls-back for labels that clean up unsafe: traversal dots or over-length", () => {
    expect(safeLogStem("a..b")).toBe("column_91beab8e");
    expect(safeLogStem("a".repeat(200))).toBe("column_4e48052d");
    expect(safeLogStem("...")).toBe(safeLogStem("..."));
  });

  it("never returns a name that could traverse or escape the trace dir", () => {
    for (const label of ["", ".", "..", "...", "a/b", "a\\b", "../../etc", "con", "nul", "😀".repeat(50), "x".repeat(500)]) {
      expectSafeStem(label);
    }
  });
});

