/**
 * @file tuning
 * @description Operator-tunable builtin tool caps, injected at composition.
 *
 * Responsibilities:
 * - Declare the optional overrides for builtin tool budgets and timeouts
 * - Provide the composition-time injection seam and execute-time accessor
 *
 * Follows the setWebSearchEnvReader precedent: the composition root applies the
 * operator's values once via setToolTuning (createBuiltinToolRegistry does this),
 * and definitions read tuned values at execute time so registration order never
 * freezes a stale number. Absent fields keep each tool's built-in default.
 */

export interface ToolTuning {
  /** Tool-result cap in chars before truncation (default MAX_OUTPUT = 32768). */
  maxOutputChars?: number;
  /** Single read/write/edit file cap in chars (default MAX_FILE = 262144). */
  maxFileChars?: number;
  /** Default run/bash timeout in seconds when the model omits it (default 30). */
  runTimeoutDefaultS?: number;
  /** Upper clamp for model-supplied run/bash timeouts in seconds (default 120). */
  runTimeoutMaxS?: number;
  /** web_fetch HTTP timeout in ms (default 15000). */
  webFetchTimeoutMs?: number;
  /** web_search HTTP timeout in ms (default 15000). */
  webSearchTimeoutMs?: number;
}

let active: ToolTuning = {};

/** Applies the operator's tool tuning (composition time; later calls replace). */
export function setToolTuning(tuning: ToolTuning): void {
  active = { ...tuning };
}

/** Tuned value for a knob, falling back to the tool's built-in default. */
export function toolTuningValue(key: keyof ToolTuning, fallback: number): number {
  const value = active[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
