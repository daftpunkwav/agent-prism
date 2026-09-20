/**
 * @file i18n/constants
 * @description Persistence key names for locale switching (single source).
 *
 * Responsibilities:
 * - Share storage/cookie names across the inline script, adapter, and toggle
 */

/** localStorage key for locale persistence (client-side preference). */
export const LOCALE_STORAGE_KEY = "agentprism-locale";

/** Cookie name mirroring the localStorage value so SSR metadata can pick the locale. */
export const LOCALE_COOKIE_NAME = "agentprism-locale";

/** Cookie lifetime: one year, matching the theme-style "sticky preference" contract. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
