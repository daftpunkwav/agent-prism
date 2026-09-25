/**
 * @file reasoning-constants
 * @description Shared reasoning-mode constants across drivers.
 *
 * Responsibilities:
 * - Single source deciding "needs retry" after reflection (reflexion keywords)
 * - Env-tunable ToT branching width and score parsing shared by native/LG/plan-execute
 *
 * Shared by the native state machine and the langgraph graph: keyword list is
 * shared; round caps differ (native caps reflexion rounds at 2, langgraph caps by max_steps).
 */

export const REFLEXION_RETRY_KEYWORDS: readonly string[] = [
  "insufficient",
  "improve",
  "retry",
  "missing",
  "error",
  "redo",
];

/** Default ToT branching width: candidate plans generated and scored per expansion. */
export const TOT_WIDTH_DEFAULT = 3;

/** Default self-consistency attempt count (each attempt is a full react loop). */
export const SELF_CONSISTENCY_ATTEMPTS_DEFAULT = 5;

/** Reads an integer env knob; non-numeric or absent values fall back, out-of-range clamps. */
function intKnob(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[key];
  const parsed = raw === undefined || raw === "" ? Number.NaN : Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/**
 * ToT branch width from ARENA_TOT_WIDTH (clamped 2-5; default 3). Each branch is
 * one independent candidate-generation call plus one independent score call.
 */
export function totWidth(env: NodeJS.ProcessEnv = process.env): number {
  return intKnob(env, "ARENA_TOT_WIDTH", TOT_WIDTH_DEFAULT, 2, 5);
}

/**
 * Self-consistency attempt count from ARENA_SELF_CONSISTENCY_N (clamped 2-9;
 * default 5). Model calls scale with the attempt count.
 */
export function selfConsistencyAttempts(env: NodeJS.ProcessEnv = process.env): number {
  return intKnob(env, "ARENA_SELF_CONSISTENCY_N", SELF_CONSISTENCY_ATTEMPTS_DEFAULT, 2, 9);
}

/**
 * Parses a `SCORE: <0-10>` verdict line (case-insensitive, optional /10 suffix).
 * Returns null when the text carries no score — callers decide the fallback.
 */
export function parseScoreVerdict(text: string): number | null {
  const match = text.match(/SCORE:\s*(10|[0-9])(?:\s*\/\s*10)?/i);
  return match === null ? null : Number(match[1]);
}
