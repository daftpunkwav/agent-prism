/**
 * @file guarded-filesystem-backend
 * @description FilesystemBackend that rejects over-complex model-supplied
 *              patterns before they reach the micromatch/braces matcher.
 *
 * Responsibilities:
 * - Bound the length, brace-nesting depth and brace-expansion size of the
 *   glob tool's pattern arg and the grep tool's glob filter arg (the only
 *   args that reach braces)
 * - Reject violations in the framework's error-result shape, so the model
 *   sees the reason and can retry with a simpler pattern instead of failing
 *   the run
 *
 * The backend is the guard's choke point because the middleware stack cannot
 * be: deepagents gives the root agent and every generated subagent their own
 * filesystem middleware sharing this one backend instance, while root custom
 * middleware is not merged into subagents. braces@3.0.3 caps input at 10,000
 * chars and numeric ranges at its own range limit, but has no nesting-depth
 * or expansion guard (GHSA-vfj7-8cjw-p6xm): deep patterns burn unbounded
 * event-loop time inside the synchronous tool call and can exhaust the call
 * stack, and sequential alternatives multiply into a cartesian explosion
 * (measured: "{a,b}" x 20 = 1,048,576 expansions in 860 ms, well within the
 * length cap). The expansion count treats groups in sequence as a product
 * and alternatives within a group as a sum, escaped braces are not counted
 * as structure, and all bounds sit orders of magnitude below any legitimate
 * glob need. grep's literal pattern arg never reaches braces and stays
 * unguarded.
 */

import { FilesystemBackend, type GlobResult, type GrepResult } from "deepagents";

/** Max pattern length accepted from a model-controlled arg, in characters. */
export const PATTERN_GUARD_MAX_LENGTH = 1024;

/** Max brace-nesting depth accepted from a model-controlled arg. */
export const PATTERN_GUARD_MAX_DEPTH = 32;

/** Max brace expansions (cartesian product of sequential groups) accepted. */
export const PATTERN_GUARD_MAX_EXPANSION = 1024;

/**
 * Rejection reason for an over-complex pattern, or null when it is
 * acceptable. Depth counts real simultaneous brace opens: escaped braces are
 * skipped, and closers cannot drive the counter below zero, so unmatched
 * closers cannot offset later openings. The expansion count is exact for
 * sequential groups (product) and alternatives (sum).
 */
export function patternGuardRejection(pattern: string): string | null {
  if (pattern.length > PATTERN_GUARD_MAX_LENGTH) {
    return `is ${pattern.length} chars (limit ${PATTERN_GUARD_MAX_LENGTH})`;
  }
  let depth = 0;
  let deepest = 0;
  let total = 1;
  // Frames per open group: sum = expansions of finished alternatives,
  // current = expansion product of the alternative being scanned.
  const stack: Array<{ sum: number; current: number }> = [];
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === "{") {
      stack.push({ sum: 0, current: 1 });
      depth += 1;
      if (depth > deepest) deepest = depth;
    } else if (ch === "}") {
      if (depth > 0) depth -= 1;
      const frame = stack.pop();
      if (frame === undefined) continue;
      const value = frame.sum + frame.current;
      const parent = stack[stack.length - 1];
      if (parent === undefined) {
        total *= value;
        if (total > PATTERN_GUARD_MAX_EXPANSION) {
          return `expands to more than ${PATTERN_GUARD_MAX_EXPANSION} combinations (limit ${PATTERN_GUARD_MAX_EXPANSION})`;
        }
      } else {
        parent.current *= value;
      }
    } else if (ch === ",") {
      const frame = stack[stack.length - 1];
      // A comma outside any group is a literal; only real frames split.
      if (frame !== undefined) {
        frame.sum += frame.current;
        frame.current = 1;
      }
    }
  }
  // Unclosed groups: braces errors out on them, but count their pending
  // alternatives anyway so the bound stays an upper bound.
  for (const frame of stack) total *= frame.sum + frame.current;
  if (total > PATTERN_GUARD_MAX_EXPANSION) {
    return `expands to more than ${PATTERN_GUARD_MAX_EXPANSION} combinations (limit ${PATTERN_GUARD_MAX_EXPANSION})`;
  }
  if (deepest > PATTERN_GUARD_MAX_DEPTH) {
    return `nests braces ${deepest} deep (limit ${PATTERN_GUARD_MAX_DEPTH})`;
  }
  return null;
}

/** FilesystemBackend rejecting over-complex patterns before any matcher runs. */
export class GuardedFilesystemBackend extends FilesystemBackend {
  override async glob(pattern: string, path?: string): Promise<GlobResult> {
    const reason = patternGuardRejection(pattern);
    if (reason !== null) {
      return { error: `[pattern guard] glob arg "pattern" ${reason}; simplify the pattern and retry` };
    }
    return super.glob(pattern, path);
  }

  override async grep(
    pattern: string,
    dirPath?: string,
    glob?: string | null,
    maxCount?: number | null,
  ): Promise<GrepResult> {
    if (typeof glob === "string") {
      const reason = patternGuardRejection(glob);
      if (reason !== null) {
        return { error: `[pattern guard] grep arg "glob" ${reason}; simplify the pattern and retry` };
      }
    }
    return super.grep(pattern, dirPath, glob, maxCount);
  }
}
