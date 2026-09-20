/**
 * @file context-time/invariant
 * @description Monotonicity and skew guards for event ordering.
 *
 * Responsibilities:
 * - Verify timestamp sequences never run backward (clock adjustments)
 * - Detect suspicious forward jumps (skew) beyond a tolerance
 * - Clamp out-of-order stamps to the last good value with a loud flag
 *
 * Event pipelines stamp with heterogeneous clocks (model vendors, tool
 * runners, UI); a single backward stamp can invert trace ordering. These
 * guards keep one monotone timeline per stream and report every correction.
 */

export interface StampCheck {
  /** Effective stamp to use (clamped when corrected). */
  stamp: number;
  /** True when the input was corrected (backward or skewed). */
  corrected: boolean;
  /** Machine-readable correction reason (null when clean). */
  reason: "backward" | "skew" | null;
}

/** Default forward-jump tolerance before a stamp counts as skewed (1 hour). */
export const SKEW_TOLERANCE_MS = 3_600_000;

/**
 * Checks one stamp against the previous stamp of the same stream.
 * Backward stamps clamp to previous; jumps beyond tolerance clamp to
 * previous + tolerance (both loud). Clean stamps pass through.
 */
export function checkStamp(previous: number | null, candidate: number, toleranceMs: number = SKEW_TOLERANCE_MS): StampCheck {
  if (!Number.isFinite(candidate)) return { stamp: previous ?? 0, corrected: true, reason: "backward" };
  if (previous === null || candidate >= previous) {
    if (previous !== null && candidate - previous > toleranceMs) {
      return { stamp: previous + toleranceMs, corrected: true, reason: "skew" };
    }
    return { stamp: candidate, corrected: false, reason: null };
  }
  return { stamp: previous, corrected: true, reason: "backward" };
}

/**
 * Repairs a stamp sequence into monotone order, returning the repaired
 * stamps plus the count of corrections (for trace honesty footers).
 */
export function repairSequence(stamps: readonly number[], toleranceMs: number = SKEW_TOLERANCE_MS): { stamps: number[]; corrections: number } {
  const out: number[] = [];
  let corrections = 0;
  let previous: number | null = null;
  for (const candidate of stamps) {
    const checked = checkStamp(previous, candidate, toleranceMs);
    if (checked.corrected) corrections += 1;
    out.push(checked.stamp);
    previous = checked.stamp;
  }
  return { stamps: out, corrections };
}
