/**
 * @file pattern guard tests
 * @description Pins the guard bounds and the backend-level rejection behavior.
 *
 * Responsibilities:
 * - Pin length and depth bounds at the exact boundary values
 * - Pin that unmatched closers cannot offset later openings (depth only ever
 *   counts real simultaneous brace opens)
 * - Pin GuardedFilesystemBackend rejection/passthrough for glob and grep
 *
 * The backend is the guard's choke point because deepagents shares one
 * backend instance across the root agent and every subagent, while root
 * custom middleware is not merged into subagents.
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PATTERN_GUARD_MAX_DEPTH,
  PATTERN_GUARD_MAX_LENGTH,
  GuardedFilesystemBackend,
  patternGuardRejection,
} from "../src/guarded-filesystem-backend.js";

/** A brace-nesting pattern `depth` levels deep, well under the length bound. */
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

  it("does not let unmatched closers offset later openings", () => {
    // 33 closers would drive the counter negative and hide the 33 later
    // openings if depth could go below zero.
    expect(patternGuardRejection("}".repeat(33) + "{".repeat(33))).toContain("nests braces 33 deep");
    expect(patternGuardRejection("}".repeat(32) + "{".repeat(32))).toBeNull();
  });
});

describe("GuardedFilesystemBackend", () => {
  function backend(): GuardedFilesystemBackend & { cleanup: () => void } {
    const rootDir = mkdtempSync(join(tmpdir(), "pattern-guard-"));
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

  it("rejects an over-long glob pattern", async () => {
    const guarded = backend();
    try {
      const result = await guarded.glob("a".repeat(PATTERN_GUARD_MAX_LENGTH + 1));
      expect(result.error).toContain("1025 chars");
    } finally {
      guarded.cleanup();
    }
  });

  it("lets ordinary glob patterns through to the real backend", async () => {
    const guarded = backend();
    try {
      const result = await guarded.glob("**/*.{ts,tsx}");
      expect(result.error).toBeUndefined();
    } finally {
      guarded.cleanup();
    }
  });

  it("rejects an over-complex grep glob filter but keeps the literal pattern unguarded", async () => {
    const guarded = backend();
    try {
      const rejected = await guarded.grep("needle", ".", nested(64));
      expect(rejected.error).toContain('[pattern guard] grep arg "glob"');
      // grep's pattern is a literal search string, not a matcher pattern.
      const literal = await guarded.grep(nested(64), ".");
      expect(literal.error).toBeUndefined();
    } finally {
      guarded.cleanup();
    }
  });
});
