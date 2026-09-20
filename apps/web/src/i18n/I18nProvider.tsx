/**
 * @file I18nProvider
 * @description Client context owning the active locale and its setter.
 *
 * Responsibilities:
 * - Start from the SSR value to keep hydration consistent
 * - Sync from localStorage after mount, matching the pre-paint script
 *
 * Persistence and DOM syncing live in setLocale; this component owns state
 * only, never copy.
 */

"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from "react";
import { storageCookieAdapter } from "./adapters/storageCookieAdapter";
import { normalizeLocale, type AppLocale } from "./locale";

type I18nContextValue = {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
};

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * Locale context provider (client-side switch with persisted preference).
 *
 * @param initialLocale Server-resolved starting locale (hydration source).
 * @param children Locale-consuming subtree.
 */
export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale: AppLocale;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<AppLocale>(initialLocale);

  // Align with the pre-paint script's decision (localStorage wins; the script has also
  // refreshed the mirror cookie). Runs pre-paint so the first client render already
  // shows the stored locale, avoiding a flash of the cookie/SSR locale.
  useLayoutEffect(() => {
    const stored = normalizeLocale(storageCookieAdapter.readClient());
    setLocaleState((prev) => (prev === stored ? prev : stored));
  }, []);

  const setLocale = useCallback((next: AppLocale) => {
    const normalized = normalizeLocale(next);
    storageCookieAdapter.write(normalized);
    // Keep <html> in lockstep with the pre-paint script's contract.
    document.documentElement.lang = normalized;
    document.documentElement.setAttribute("data-locale", normalized);
    setLocaleState(normalized);
  }, []);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Internal accessor; feature code should use useLocale/useSetLocale/useT instead. */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return ctx;
}
