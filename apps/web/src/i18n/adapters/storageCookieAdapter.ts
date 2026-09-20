/**
 * @file storageCookieAdapter
 * @description First-party LocaleAdapter: localStorage plus an SSR mirror cookie.
 *
 * Responsibilities:
 * - Own all locale persistence access
 * - Mirror the preference into a SameSite=Lax cookie for SSR
 *
 * Feature code must never touch localStorage for locale directly.
 */

import {
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  LOCALE_STORAGE_KEY,
} from "../constants";
import type { AppLocale } from "../locale";
import type { LocaleAdapter } from "./types";

/** Reads one cookie's value out of a raw Cookie request header. */
function readCookieHeader(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

export const storageCookieAdapter: LocaleAdapter = {
  readClient(): string | null {
    try {
      return globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY) ?? null;
    } catch {
      // Storage unavailable (privacy mode, sandbox): fall through to the default locale.
      return null;
    }
  },

  readServer(cookieHeader?: string): string | null {
    return readCookieHeader(cookieHeader, LOCALE_COOKIE_NAME);
  },

  write(locale: AppLocale): void {
    try {
      globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Ignore write failures: the cookie below still carries the preference for this visit.
    }
    try {
      globalThis.document.cookie =
        `${LOCALE_COOKIE_NAME}=${locale};path=/;max-age=${LOCALE_COOKIE_MAX_AGE};samesite=lax`;
    } catch {
      // Non-browser or blocked cookies: localStorage (if it worked) remains the source of truth.
    }
  },
};
