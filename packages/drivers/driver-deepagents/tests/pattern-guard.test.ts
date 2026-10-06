/**
 * @file pattern guard tests
 * @description Pins the guard bounds and the backend-level rejection behavior.
 *
 * Responsibilities:
 * - Pin length, depth and expansion bounds at their exact boundary values
 * - Pin that escaped braces are not structural and unmatched closers cannot
 *   offset later openings
 * - Pin GuardedFilesystemBackend rejection/passthrough for glob and grep by
 *   asserting real matched results, not just absence of errors
 *
 * The backend is the guard's choke point because deepagents shares one
 * backend instance across the root agent and every subagent, while root
 * custom middleware is not merged into subagents.
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PATTERN_GUARD_MAX_DEPTH,
  PATTERN_GUARD_MAX_EXPANSION,
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
  /** Backend over a temp root holding one matchable text file. */
  function backend(): GuardedFilesystemBackend & { cleanup: () => void } {
    const rootDir = mkdtempSync(join(tmpdir(), "pattern-guard-"));
    writeFileSync(join(rootDir, "app.txt"), "needle-content marker\n", "utf8");
    const instance = new GuardedFilesystemBackend({ rootDir, virtualMode: true });
    return Object.assign(instance, {
      cleanup: () => rmSync(rootDir, { recursive: true, force: true }),
    });
  }

  it("rejects an over-complex glob pattern in the framework error shape", async () => {
    const guarded = backend();
    try {
      const result = await guarded.glob(nested(64));
      expect(result.error).toContain('[pattern guard] glob arg "pattern"');
      expect(result.error).toContain("nests braces 64 deep");
    } finally {
      guarded.cleanup();
    }
  });

  it("rejects an expansion-bombing glob pattern", async () => {
    const guarded = backend();
    try {
      const result = await guarded.glob("{a,b}".repeat(11));
      expect(result.error).toContain("more than 1024 combinations");
    } finally {
      guarded.cleanup();
    }
  });

  it("rejects an over-long glob pattern", async () => {
    const guarded = backend();
    try {
      const result = await guarded.glob("a".repeat(PATTERN_GUARD_MAX_LENGTH + 1));
      expect(result.error).toContain("1025 chars");
    } finally {
      guarded.cleanup();
    }
  });

  it("passes ordinary glob patterns through to the real backend", async () => {
    const guarded = backend();
    try {
      // A skipped super call would return no files; the seeded app.txt must
      // come back to prove the base backend actually ran.
      const result = await guarded.glob("*.{txt,md}");
      expect(result.error).toBeUndefined();
      expect(result.files?.length).toBe(1);
      expect(JSON.stringify(result)).toContain("app.txt");
    } finally {
      guarded.cleanup();
    }
  });

  it("rejects an over-complex grep glob filter but keeps the literal pattern unguarded", async () => {
    const guarded = backend();
    try {
      const rejected = await guarded.grep("needle-content", ".", nested(64));
      expect(rejected.error).toContain('[pattern guard] grep arg "glob"');
      // grep's pattern is a literal search string, not a matcher pattern.
      const literal = await guarded.grep("needle-content", ".");
      expect(literal.error).toBeUndefined();
      expect(literal.matches?.length).toBeGreaterThan(0);
      expect(JSON.stringify(literal)).toContain("needle-content marker");
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
      expect(JSON.stringify(result)).toContain("app.txt");
    } finally {
      guarded.cleanup();
    }
  });
});
