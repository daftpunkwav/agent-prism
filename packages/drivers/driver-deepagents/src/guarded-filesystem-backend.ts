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
 * chars but has no nesting-depth or expansion guard (GHSA-vfj7-8cjw-p6xm):
 * deep patterns burn unbounded event-loop time inside the synchronous tool
 * call and can exhaust the call stack, and sequential alternatives multiply
 * into a cartesian explosion (measured: "{a,b}" x 20 = 1,048,576 expansions
 * in 860 ms, well within the length cap; "{1..999}" pairs likewise). The
 * expansion count treats groups in sequence as a product and alternatives
 * within a group as a sum, counts each range (signed, stepped included) at
 * its true cardinality, skips escaped braces, and sits orders of magnitude
 * below any legitimate glob need. grep's literal pattern arg never reaches
 * braces and stays unguarded.
 */

import { FilesystemBackend, type GlobResult, type GrepResult } from "deepagents";

/** Max pattern length accepted from a model-controlled arg, in characters. */
export const PATTERN_GUARD_MAX_LENGTH = 1024;

/** Max brace-nesting depth accepted from a model-controlled arg. */
export const PATTERN_GUARD_MAX_DEPTH = 32;

/** Max brace expansions (cartesian product of sequential groups) accepted. */
export const PATTERN_GUARD_MAX_EXPANSION = 1024;

/**
 * Conservative cardinality for a `{a..b}`-shaped pair that does not parse
 * as a numeric or same-case alphabetic range (braces would treat it as a
 * literal, but the guard assumes the worst rather than bet on that).
 */
const MAX_RANGE_CARDINALITY = 1000;

/** Cardinality of a braces range pair, conservative when unparseable. */
function rangeCardinality(startStr: string, endStr: string, stepStr: string): number {
  if (startStr === "" || endStr === "") return 1;
  const applyStep = (span: number): number => {
    if (stepStr === "") return span;
    if (!/^-?[0-9]+$/.test(stepStr) || Number(stepStr) === 0) return MAX_RANGE_CARDINALITY;
    return Math.ceil(span / Math.abs(Number(stepStr)));
  };
  if (/^-?[0-9]+$/.test(startStr) && /^-?[0-9]+$/.test(endStr)) {
    return applyStep(Math.abs(Number(endStr) - Number(startStr)) + 1);
  }
  if (startStr.length === 1 && endStr.length === 1) {
    const sameCase =
      (startStr === startStr.toLowerCase()) === (endStr === endStr.toLowerCase());
    if (sameCase && /[a-zA-Z]/.test(startStr) && /[a-zA-Z]/.test(endStr)) {
      return applyStep(Math.abs(endStr.charCodeAt(0) - startStr.charCodeAt(0)) + 1);
    }
  }
  return MAX_RANGE_CARDINALITY;
}

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
    } else if (ch === "." && pattern[i + 1] === ".") {
      // A `{a..b}` (optionally `{a..b..step}`) range multiplies the current
      // alternative by its cardinality; outside any group it is a literal
      // and braces ignores it. The whole expression is consumed so its
      // inner tokens (including a second "..") cannot re-trigger here.
      const frame = stack[stack.length - 1];
      if (frame !== undefined) {
        const token = /[0-9a-zA-Z-]/;
        const readToken = (from: number): [string, number] => {
          let j = from;
          while (j < pattern.length && token.test(pattern[j] ?? "")) j += 1;
          return [pattern.slice(from, j), j];
        };
        let start = i;
        while (start > 0 && token.test(pattern[start - 1] ?? "")) start -= 1;
        const [endStr, afterEnd] = readToken(i + 2);
        let stepStr = "";
        let rangeEnd = afterEnd;
        if (pattern[afterEnd] === "." && pattern[afterEnd + 1] === ".") {
          const [step, afterStep] = readToken(afterEnd + 2);
          stepStr = step;
          rangeEnd = afterStep;
        }
        frame.current *= rangeCardinality(pattern.slice(start, i), endStr, stepStr);
        i = rangeEnd - 1;
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
