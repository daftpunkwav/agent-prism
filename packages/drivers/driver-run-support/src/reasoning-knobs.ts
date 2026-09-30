/**
 * @file reasoning-knobs
 * @description Env-tunable reasoning knobs and shared verdict parsing across drivers.
 *
 * Responsibilities:
 * - Single source deciding "needs retry" after reflection (reflexion keywords)
 * - Env-tunable ToT branching width and self-consistency attempt count (ARENA_TOT_WIDTH / ARENA_SELF_CONSISTENCY_N)
 * - Score parsing shared by native/LG/plan-execute ToT loops
 *
 * Shared by the native state machine and the langgraph graph: keyword list is
 * shared; round caps differ (native caps reflexion rounds at 2, langgraph caps by max_steps).
 *
 * The reasoning-width defaults are single-sourced in contracts (runtime-knobs)
 * and re-exported here under the driver-side name, so the settings-UI knob
 * default and the env fallback below cannot drift.
 */

import { SELF_CONSISTENCY_N_DEFAULT, TOT_WIDTH_DEFAULT } from "@agentprism/contracts";

export { TOT_WIDTH_DEFAULT, SELF_CONSISTENCY_N_DEFAULT as SELF_CONSISTENCY_ATTEMPTS_DEFAULT };

export const REFLEXION_RETRY_KEYWORDS: readonly string[] = [
  "insufficient",
  "improve",
  "retry",
  "missing",
  "error",
  "redo",
];

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
  return intKnob(env, "ARENA_SELF_CONSISTENCY_N", SELF_CONSISTENCY_N_DEFAULT, 2, 9);
}

/**
 * Parses a `SCORE: <0-10>` verdict line (case-insensitive, optional /10 suffix).
 * Returns null when the text carries no score — callers decide the fallback.
 */
export function parseScoreVerdict(text: string): number | null {
  const match = text.match(/SCORE:\s*(10|[0-9])(?:\s*\/\s*10)?/i);
  return match === null ? null : Number(match[1]);
}
