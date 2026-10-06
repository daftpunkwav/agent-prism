/**
 * @file guarded-filesystem-backend
 * @description FilesystemBackend that rejects over-complex model-supplied
 *              patterns before they reach the micromatch/braces matcher.
 *
 * Responsibilities:
 * - Bound the length and brace-nesting depth of the glob tool's pattern arg
 *   and the grep tool's glob filter arg (the only args that reach braces)
 * - Reject violations in the framework's error-result shape, so the model
 *   sees the reason and can retry with a simpler pattern instead of failing
 *   the run
 *
 * The backend is the guard's choke point because the middleware stack cannot
 * be: deepagents gives the root agent and every generated subagent their own
 * filesystem middleware sharing this one backend instance, while root custom
 * middleware is not merged into subagents. braces@3.0.3 caps input at 10,000
 * chars but has no nesting-depth guard (GHSA-vfj7-8cjw-p6xm): deep patterns
 * burn unbounded event-loop time inside the synchronous tool call and can
 * exhaust the call stack. Both bounds sit orders of magnitude below any
 * legitimate glob need; escaped braces are counted too, which only makes the
 * guard stricter. grep's literal pattern arg never reaches braces and stays
 * unguarded.
 */

import { FilesystemBackend, type GlobResult, type GrepResult } from "deepagents";

/** Max pattern length accepted from a model-controlled arg, in characters. */
export const PATTERN_GUARD_MAX_LENGTH = 1024;

/** Max brace-nesting depth accepted from a model-controlled arg. */
export const PATTERN_GUARD_MAX_DEPTH = 32;

/**
 * Rejection reason for an over-complex pattern, or null when it is
 * acceptable. Depth counts raw `{`/`}` nesting; closers cannot drive the
 * counter below zero, so unmatched closers cannot offset later openings.
 */
export function patternGuardRejection(pattern: string): string | null {
  if (pattern.length > PATTERN_GUARD_MAX_LENGTH) {
    return `is ${pattern.length} chars (limit ${PATTERN_GUARD_MAX_LENGTH})`;
  }
  let depth = 0;
  let deepest = 0;
  for (const ch of pattern) {
    if (ch === "{") {
      depth += 1;
      if (depth > deepest) deepest = depth;
    } else if (ch === "}" && depth > 0) {
      depth -= 1;
    }
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
