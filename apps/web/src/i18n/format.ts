/**
 * @file i18n/format
 * @description Intl wrappers bound to the active AppLocale.
 *
 * Responsibilities:
 * - Provide date and number formatting for the active locale
 *
 * Feature code must call these instead of hardcoding a locale.
 */

import type { AppLocale } from "./locale";

/** Locale-sensitive date-time rendering (e.g. project archive timestamps). */
export function formatDateTime(locale: AppLocale, iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(locale);
}

/** Locale-sensitive number rendering with optional Intl options. */
export function formatNumber(
  locale: AppLocale,
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return value.toLocaleString(locale, options);
}
