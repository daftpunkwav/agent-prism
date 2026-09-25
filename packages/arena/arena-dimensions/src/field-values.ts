/**
 * @file field-values
 * @description Option-token utilities for numeric dimension fields.
 *
 * Responsibilities:
 * - Coerce and normalize raw field values
 * - Snap values onto the allowed option set (int and float paths)
 */

const FLOAT_FIELDS = new Set(["temperature", "top_p", "frequency_penalty", "presence_penalty"]);
const INT_FIELDS = new Set(["max_steps", "max_output_tokens", "thinking_budget"]);

/** Baseline token for "no step budget" (max_steps only); coerces to the -1 sentinel. */
const UNLIMITED_TOKEN = "unlimited";

/** Whether a token is the unlimited-steps marker. */
export function isUnlimitedToken(field: string, token: string): boolean {
  return field === "max_steps" && (token === UNLIMITED_TOKEN || token === "-1");
}

/** Whether the field is a float-typed decode field. */
export function isFloatField(field: string): boolean {
  return FLOAT_FIELDS.has(field);
}

/** Coerces a baseline field value according to the field's type. */
export function coerceFieldValue(field: string, value: unknown): unknown {
  if (FLOAT_FIELDS.has(field)) return Number(value);
  if (INT_FIELDS.has(field)) {
    if (typeof value === "string" && isUnlimitedToken(field, value)) return -1;
    return Math.trunc(Number(value));
  }
  return value;
}

/** Normalizes to an option token (float %g / int decimal); the unlimited token passes through. */
export function normalizeOptionToken(field: string, value: unknown): string {
  if (typeof value === "string" && isUnlimitedToken(field, value)) return UNLIMITED_TOKEN;
  if (FLOAT_FIELDS.has(field)) {
    return formatG(Number(value));
  }
  if (INT_FIELDS.has(field)) {
    return String(Math.trunc(Number(value)));
  }
  return String(value);
}

/** %g-equivalent formatting (strips trailing zeros). */
function formatG(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  const precision = 6;
  let formatted = value.toPrecision(precision);
  if (formatted.includes(".")) {
    formatted = formatted.replace(/0+$/, "").replace(/\.$/, "");
  }
  return formatted;
}

/** Nearest allowed value; falls back to the input when the allowlist is empty. */
function nearestTo(value: number, allowed: readonly number[]): number {
  let best = allowed[0];
  for (const candidate of allowed) {
    if (best === undefined || Math.abs(candidate - value) < Math.abs(best - value)) {
      best = candidate;
    }
  }
  return best ?? value;
}

/** Snaps to the nearest allowed value and returns the token. */
export function snapToOptions(value: number, allowed: readonly number[]): string {
  return formatG(nearestTo(value, allowed));
}

/** Snaps to the nearest allowed integer value and returns it as display text. */
export function snapIntToOptions(value: number, allowed: readonly number[]): string {
  return String(nearestTo(value, allowed));
}
