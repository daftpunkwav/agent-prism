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
 * its true cardinality bounded by braces' own 1000-item per-range ceiling,
 * skips escaped braces, and sits orders of magnitude below any legitimate
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
 * Upper cardinality braces itself accepts for one range: past 1000 items it
 * throws a RangeError instead of expanding. Endpoints beyond the safe
 * integer range are also rejected here: fill-range cannot advance such a
 * range and burns seconds of synchronous CPU before failing.
 */
const MAX_RANGE_CARDINALITY = 1000;

/**
 * Numeric endpoint/step shape: fill-range parses plain integers, decimals
 * and scientific notation (with sign), counting them by value, so the guard
 * must recognize the same forms.
 */
const NUMERIC_SHAPE = /^[+-]?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

function rangeCardinality(startStr: string, endStr: string, stepStr: string): number {
  if (startStr === "" || endStr === "") return 1;
  const spanOf = (a: number, b: number) => Math.abs(b - a) + 1;
  let span: number;
  if (NUMERIC_SHAPE.test(startStr) && NUMERIC_SHAPE.test(endStr)) {
    const a = Number(startStr);
    const b = Number(endStr);
    // Non-integers, infinities and beyond-safe-integer endpoints either
    // throw inside braces after burning seconds of CPU or do not expand at
    // all: reject them here as unbounded.
    if (
      !Number.isInteger(a) ||
      !Number.isInteger(b) ||
      Math.abs(a) > Number.MAX_SAFE_INTEGER ||
      Math.abs(b) > Number.MAX_SAFE_INTEGER
    ) {
      return Number.POSITIVE_INFINITY;
    }
    span = spanOf(a, b);
  } else if (startStr.length === 1 && endStr.length === 1) {
    // Any single-character pair (punctuation included) expands across char
    // codes: {!..~} yields the 94 printable-ASCII punctuation values.
    span = spanOf(startStr.charCodeAt(0), endStr.charCodeAt(0));
  } else {
    // Multi-character non-numeric endpoints stay literal (measured:
    // {foo..bar}, {a..alk}, {a b..c} each expand to themselves).
    return 1;
  }
  if (stepStr === "") return span;
  if (!NUMERIC_SHAPE.test(stepStr)) return Number.POSITIVE_INFINITY;
  const step = Math.abs(Number(stepStr));
  if (!Number.isFinite(step) || step === 0) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.ceil(span / step));
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
  // current = expansion product of the alternative being scanned, and
  // whether a top-level comma split the group (braces then treats range
  // syntax inside the alternatives as literal text, measured:
  // {foo,1..600} expands to exactly two entries).
  const stack: Array<{ sum: number; current: number; seenComma: boolean }> = [];
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      // Braces assigns no meaning to quotes; a closed quoted span stays
      // literal, so skip it whole. An unmatched quote falls through as an
      // ordinary character (over-counting is the safe direction).
      const close = pattern.indexOf(ch, i + 1);
      if (close !== -1) i = close;
      continue;
    }
    if (ch === "[") {
      // Measured: a closed bracket expression keeps its content literal
      // ([{a,b}] expands to itself). Unmatched "[" scans on as a literal.
      const close = pattern.indexOf("]", i + 1);
      if (close !== -1) i = close;
      continue;
    }
    if (ch === "{") {
      stack.push({ sum: 0, current: 1, seenComma: false });
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
        frame.seenComma = true;
      }
    } else if (ch === "." && pattern[i + 1] === ".") {
      // A `{a..b}` (optionally `{a..b..step}`) range multiplies the current
      // alternative by its cardinality - but only while the group holds a
      // single alternative, since braces then treats range syntax as
      // literal text. Outside any group it is a literal too. The whole
      // expression is consumed so its inner tokens (including a second
      // "..") cannot re-trigger here.
      const frame = stack[stack.length - 1];
      if (frame !== undefined && !frame.seenComma) {
        // Endpoints/steps collect every non-structural character: braces
        // expands punctuation pairs ({!..~}) and fill-range parses signs
        // and exponents ({1e+2..2e+2}), so the guard must see them too.
        const token = /[^{},]/;
        const readToken = (from: number): [string, number] => {
          let j = from;
          while (j < pattern.length && token.test(pattern[j] ?? "")) j += 1;
          return [pattern.slice(from, j), j];
        };
        let start = i;
        while (start > 0 && token.test(pattern[start - 1] ?? "")) start -= 1;
        const [collected, afterEnd] = readToken(i + 2);
        // The collected span may ride through the ".." that starts the step
        // (both are non-structural): split end and step at the first one.
        let endStr = collected;
        let stepStr = "";
        const stepIdx = collected.indexOf("..");
        if (stepIdx !== -1) {
          endStr = collected.slice(0, stepIdx);
          stepStr = collected.slice(stepIdx + 2);
        }
        let rangeEnd = afterEnd;
        const cardinality = rangeCardinality(pattern.slice(start, i), endStr, stepStr);
        if (cardinality > MAX_RANGE_CARDINALITY) {
          // Beyond braces' own per-range ceiling it throws instead of
          // expanding; rejecting here keeps the error a controlled one.
          return `range spans more than ${MAX_RANGE_CARDINALITY} items (limit ${MAX_RANGE_CARDINALITY})`;
        }
        frame.current *= cardinality;
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
