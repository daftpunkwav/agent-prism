/**
 * @file bootstrapScript
 * @description Generates the pre-paint locale script for the root layout head.
 *
 * Responsibilities:
 * - Read localStorage before first paint and apply lang/data-locale to html
 * - Sync the mirror cookie for the next SSR request
 *
 * The script must stay self-contained (no TS imports); its decision logic is
 * LOCALE_PICK_SNIPPET, a byte-level mirror of normalizeLocale's rules, with
 * parity locked by apps/web/tests/locale-bootstrap.test.ts — change both together.
 */

import {
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  LOCALE_STORAGE_KEY,
} from "./constants";
import { DEFAULT_LOCALE } from "./locale";

/**
 * Inline decision function mirroring normalizeLocale (exact match → aliases →
 * default). Exported solely so tests can evaluate the same code the script runs.
 */
export const LOCALE_PICK_SNIPPET = `
function __pickLocale(raw) {
  var DEFAULT = ${JSON.stringify(DEFAULT_LOCALE)};
  if (typeof raw !== 'string') return DEFAULT;
  var v = raw.trim();
  if (v === '') return DEFAULT;
  if (v === 'zh-CN' || v === 'en') return v;
  var ALIASES = { 'zh': 'zh-CN', 'zh-Hans': 'zh-CN', 'zh_CN': 'zh-CN', 'en-US': 'en', 'en-GB': 'en' };
  return ALIASES[v] || DEFAULT;
}`;

export const localeBootstrapScript = `(function () {
  ${LOCALE_PICK_SNIPPET}
  try {
    var locale = __pickLocale(localStorage.getItem('${LOCALE_STORAGE_KEY}'));
    document.documentElement.lang = locale;
    document.documentElement.setAttribute('data-locale', locale);
    document.cookie = '${LOCALE_COOKIE_NAME}=' + locale + ';path=/;max-age=${LOCALE_COOKIE_MAX_AGE};samesite=lax';
  } catch (e) {
    document.documentElement.lang = '${DEFAULT_LOCALE}';
    document.documentElement.setAttribute('data-locale', '${DEFAULT_LOCALE}');
  }
})();`;
