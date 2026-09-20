/**
 * @file context-time/timestamp
 * @description UTC timestamp formatting, parsing, and day boundaries.
 *
 * Responsibilities:
 * - Format instants as UTC date/datetime strings for prompt grounding
 * - Parse them back with validation (fail-closed on malformed input)
 * - Compute UTC day boundaries for staleness windows
 *
 * All functions take the instant as a parameter: business code must never
 * read the ambient clock (inject `Date.now()` at the composition edge).
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

/** Formats an instant as `YYYY-MM-DD (UTC)` for prompt time lines. */
export function formatUtcDate(nowMs: number): string {
  if (!Number.isFinite(nowMs) || nowMs <= 0) return "unknown date";
  return `${new Date(nowMs).toISOString().slice(0, 10)} (UTC)`;
}

/** Formats an instant as full `YYYY-MM-DDTHH:mm:ssZ`. */
export function formatUtcDateTime(nowMs: number): string {
  if (!Number.isFinite(nowMs) || nowMs <= 0) return "unknown datetime";
  return new Date(nowMs).toISOString().slice(0, 19) + "Z";
}

/** Parses `YYYY-MM-DD` into epoch ms (NaN when malformed or impossible). */
export function parseUtcDate(text: string): number {
  const match = DATE_RE.exec(text.trim());
  if (match === null) return NaN;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!Number.isFinite(ms)) return NaN;
  // Round-trip guard: Date.UTC normalizes overflows (e.g. month 13 rolls over).
  const check = new Date(ms).toISOString().slice(0, 10);
  return check === text.trim() ? ms : NaN;
}

/** Parses full `YYYY-MM-DDTHH:mm:ssZ` into epoch ms (NaN when malformed). */
export function parseUtcDateTime(text: string): number {
  const match = DATETIME_RE.exec(text.trim());
  if (match === null) return NaN;
  const ms = Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6]),
  );
  if (!Number.isFinite(ms)) return NaN;
  const check = new Date(ms).toISOString().slice(0, 19) + "Z";
  return check === text.trim() ? ms : NaN;
}

/** Start of the UTC day containing the instant (epoch ms). */
export function startOfUtcDay(nowMs: number): number {
  const date = new Date(nowMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Whole UTC days elapsed from `fromMs` to `toMs` (negative when reversed). */
export function wholeDaysBetween(fromMs: number, toMs: number): number {
  return Math.trunc((startOfUtcDay(toMs) - startOfUtcDay(fromMs)) / 86_400_000);
}
