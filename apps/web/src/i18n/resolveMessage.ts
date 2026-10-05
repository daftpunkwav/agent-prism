/**
 * @file resolveMessage
 * @description Dot-key lookup with placeholder interpolation and fallback chain.
 *
 * Responsibilities:
 * - Resolve current locale, then default locale, then dev marker / prod key
 *
 * A missing key must never silently render as an empty string.
 */

import { DEFAULT_LOCALE, type AppLocale } from "./locale";
import { getCatalog } from "./catalogs";
import type { MessageKey, MessageParams } from "./catalogs/types";

/** Looks a dot key up in one catalog; null when the path misses. */
function lookup(catalog: unknown, key: string): string | null {
  let node: unknown = catalog;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null || !Object.hasOwn(node, part)) return null;
    node = Reflect.get(node, part);
  }
  return typeof node === "string" ? node : null;
}

/** Replaces {name} placeholders; unknown params stay visible for discoverability. */
function interpolate(template: string, params: MessageParams | undefined): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** Dev-only, warn at most once per missing key. */
const warnedKeys = new Set<string>();

/**
 * Resolves a message with the full fallback chain. In development a missing key
 * renders as ⟦key⟧ with a console warning; in production it degrades to the raw
 * key string instead of crashing or hiding the slot. Both degraded shapes are
 * recognized by `isMissingMessage`, the single check for callers that carry
 * their own fallback text.
 */
export function resolveMessage(
  locale: AppLocale,
  key: MessageKey,
  params?: MessageParams,
): string {
  const primary = lookup(getCatalog(locale), key);
  if (primary !== null) return interpolate(primary, params);
  if (locale !== DEFAULT_LOCALE) {
    const fallback = lookup(getCatalog(DEFAULT_LOCALE), key);
    if (fallback !== null) return interpolate(fallback, params);
  }
  if (process.env.NODE_ENV !== "production") {
    if (!warnedKeys.has(key)) {
      warnedKeys.add(key);
      console.warn(`[i18n] Missing message key "${key}" for locale "${locale}"`);
    }
    return `⟦${key}⟧`;
  }
  return key;
}

/**
 * Whether a resolved message is a missing-key fallback rather than catalog text
 * (the dev marker or the production raw key). Callers holding their own display
 * fallback — server-provided labels for dynamic options — must test with this,
 * never by matching the marker themselves: the degraded shapes are owned here.
 */
export function isMissingMessage(resolved: string, key: string): boolean {
  return resolved.startsWith("⟦") || resolved === key;
}
