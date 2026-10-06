/**
 * @file pattern guard tests
 * @description Pins the guard bounds and the backend-level rejection behavior.
 *
 * Responsibilities:
 * - Pin length, depth and expansion bounds at their exact boundary values,
 *   including numeric and alphabetic range cardinalities
 * - Pin that escaped braces are not structural and unmatched closers cannot
 *   offset later openings
 * - Pin GuardedFilesystemBackend rejection happens before any matcher call
 *   (spied), and passthrough by asserting real matched results including a
 *   seeded file that must NOT match
 *
 * The backend is the guard's choke point because deepagents shares one
 * backend instance across the root agent and every subagent, while root
 * custom middleware is not merged into subagents.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemBackend } from "deepagents";
import {
  PATTERN_GUARD_MAX_DEPTH,
  PATTERN_GUARD_MAX_LENGTH,
  GuardedFilesystemBackend,
  patternGuardRejection,
} from "../src/guarded-filesystem-backend.js";

/** A brace-nesting pattern `depth` levels deep, well under the other bounds. */
function nested(depth: number): string {
  return "{a,".repeat(depth) + "b" + "}".repeat(depth);
}

describe("patternGuardRejection", () => {
  it("accepts ordinary globs", () => {
    expect(patternGuardRejection("**/*.{ts,tsx}")).toBeNull();
    expect(patternGuardRejection("src/**/*.{1..12}.txt")).toBeNull();
  });

  it("bounds length at exactly 1024 chars", () => {
    expect(patternGuardRejection("a".repeat(PATTERN_GUARD_MAX_LENGTH))).toBeNull();
    expect(patternGuardRejection("a".repeat(PATTERN_GUARD_MAX_LENGTH + 1))).toContain("1025 chars");
  });

  it("bounds brace nesting at exactly 32 deep", () => {
    expect(patternGuardRejection(nested(PATTERN_GUARD_MAX_DEPTH))).toBeNull();
    expect(patternGuardRejection(nested(PATTERN_GUARD_MAX_DEPTH + 1))).toContain("nests braces 33 deep");
  });

  it("bounds the expansion of sequential groups at exactly 1024 combinations", () => {
    expect(patternGuardRejection("{a,b}".repeat(10))).toBeNull();
    expect(patternGuardRejection("{a,b}".repeat(11))).toContain("more than 1024 combinations");
  });

  it("counts range cardinalities in the expansion bound", () => {
    expect(patternGuardRejection("{1..999}")).toBeNull();
    expect(patternGuardRejection("{a..z}")).toBeNull();
    // Two sequential ranges multiply far past the bound.
    expect(patternGuardRejection("{1..999}{1..999}")).toContain("more than 1024 combinations");
    expect(patternGuardRejection("{1..999}{a,b}")).toContain("more than 1024 combinations");
    // Signed bounds count their real cardinality (the sign must not be
    // dropped, which would collapse {-5..5} to cardinality 1).
    expect(patternGuardRejection("{-5..5}")).toBeNull();
    expect(patternGuardRejection("{-5..5}".repeat(3))).toContain("more than 1024 combinations");
    expect(patternGuardRejection("{-3..3}{-3..3}")).toBeNull();
    // Stepped ranges count their stepped cardinality, not the raw span.
    expect(patternGuardRejection("{1..10..2}")).toBeNull();
    expect(patternGuardRejection("{1..2048..2}")).toBeNull();
    expect(patternGuardRejection("{1..4097..2}")).toContain("more than 1024 combinations");
    // True cardinality: a single huge range is rejected outright instead of
    // being left for braces to fail on.
    expect(patternGuardRejection("{1..999999}")).toContain("more than 1024 combinations");
    // A lone range never trips the bound; ../ in paths is not a range.
    expect(patternGuardRejection("../src/*.{ts,tsx}")).toBeNull();
  });

  it("does not let unmatched closers offset later openings", () => {
    // 33 closers would drive the counter negative and hide the 33 later
    // openings if depth could go below zero.
    expect(patternGuardRejection("}".repeat(33) + "{".repeat(33))).toContain("nests braces 33 deep");
    expect(patternGuardRejection("}".repeat(32) + "{".repeat(32))).toBeNull();
  });

  it("does not count escaped braces as structure", () => {
    // Escaped closers let the depth counter run past the real nesting:
    // 20 real opens, then 15 escaped-closer/open pairs that a naive counter
    // nets to zero but actually push the nesting to 35.
    const hidden = "{".repeat(20) + "\\}{".repeat(15);
    expect(patternGuardRejection(hidden)).toContain("nests braces 35 deep");
    // Escaped openers must not inflate the depth either.
    expect(patternGuardRejection("{a,\\{,b}")).toBeNull();
  });
});

describe("GuardedFilesystemBackend", () => {
  /** Backend over a temp root with one matching and one filtered-out file. */
  function backend(): GuardedFilesystemBackend & { cleanup: () => void } {
    const rootDir = mkdtempSync(join(tmpdir(), "pattern-guard-"));
    writeFileSync(join(rootDir, "app.txt"), "needle-content marker\n", "utf8");
    // Matches the needle but fails every *.{txt,md}-style filter used below;
    // an implementation that drops the filter would leak it into results.
    writeFileSync(join(rootDir, "other.log"), "needle-content marker\n", "utf8");
    const instance = new GuardedFilesystemBackend({ rootDir, virtualMode: true });
    return Object.assign(instance, {
      cleanup: () => rmSync(rootDir, { recursive: true, force: true }),
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects an over-complex glob pattern before any matcher call", async () => {
    const matcher = vi.spyOn(FilesystemBackend.prototype, "glob");
    const guarded = backend();
    try {
      const result = await guarded.glob(nested(64));
      expect(result.error).toContain('[pattern guard] glob arg "pattern"');
      expect(result.error).toContain("nests braces 64 deep");
      expect(matcher).not.toHaveBeenCalled();
    } finally {
      guarded.cleanup();
    }
  });

  it("rejects an expansion-bombing glob pattern before any matcher call", async () => {
    const matcher = vi.spyOn(FilesystemBackend.prototype, "glob");
    const guarded = backend();
    try {
      const result = await guarded.glob("{a,b}".repeat(11));
      expect(result.error).toContain("more than 1024 combinations");
      expect(matcher).not.toHaveBeenCalled();
    } finally {
      guarded.cleanup();
    }
  });

  it("rejects an over-long glob pattern before any matcher call", async () => {
    const matcher = vi.spyOn(FilesystemBackend.prototype, "glob");
    const guarded = backend();
    try {
      const result = await guarded.glob("a".repeat(PATTERN_GUARD_MAX_LENGTH + 1));
      expect(result.error).toContain("1025 chars");
      expect(matcher).not.toHaveBeenCalled();
    } finally {
      guarded.cleanup();
    }
  });

  it("rejects an over-complex grep glob filter before any matcher call", async () => {
    const matcher = vi.spyOn(FilesystemBackend.prototype, "grep");
    const guarded = backend();
    try {
      const rejected = await guarded.grep("needle-content", ".", nested(64));
      expect(rejected.error).toContain('[pattern guard] grep arg "glob"');
      expect(matcher).not.toHaveBeenCalled();
    } finally {
      guarded.cleanup();
    }
  });

  it("passes ordinary glob patterns through to the real backend", async () => {
    const guarded = backend();
    try {
      // A skipped super call would return no files; app.txt must come back
      // and other.log (which fails the filter) must stay out, so both a
      // skipped call and a dropped filter are caught.
      const result = await guarded.glob("*.{txt,md}");
      expect(result.error).toBeUndefined();
      expect(result.files?.length).toBe(1);
      const listed = JSON.stringify(result);
      expect(listed).toContain("app.txt");
      expect(listed).not.toContain("other.log");
    } finally {
      guarded.cleanup();
    }
  });

  it("keeps the literal grep pattern unguarded and the glob filter effective", async () => {
    const guarded = backend();
    try {
      const literal = await guarded.grep("needle-content", ".");
      expect(literal.error).toBeUndefined();
      expect(literal.matches?.length).toBeGreaterThan(0);
      // grep's pattern is a literal search string, not a matcher pattern:
      // it must reach the real backend and search both files.
      const literalJson = JSON.stringify(literal);
      expect(literalJson).toContain("needle-content marker");
      expect(literalJson).toContain("other.log");
      // A literal far past every guard bound must still flow through
      // unguarded - guarding it would break legitimate literal searches.
      const heavy = await guarded.grep("{".repeat(64), ".");
      expect(heavy.error).toBeUndefined();
    } finally {
      guarded.cleanup();
    }
  });

  it("passes a compliant grep glob filter through to the real backend", async () => {
    const guarded = backend();
    try {
      const result = await guarded.grep("needle-content", ".", "*.{txt,md}");
      expect(result.error).toBeUndefined();
      expect(result.matches?.length).toBeGreaterThan(0);
      const resultJson = JSON.stringify(result);
      expect(resultJson).toContain("app.txt");
      // other.log also contains the needle but fails the filter; its absence
      // proves the filter reached the base backend.
      expect(resultJson).not.toContain("other.log");
    } finally {
      guarded.cleanup();
    }
  });
});
