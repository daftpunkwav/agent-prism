/**
 * @file useT
 * @description Feature-facing i18n hooks: locale, setter, and translate.
 *
 * Responsibilities:
 * - Bind the translate function to the current locale's fallback chain
 *
 * Views depend only on these — never on storage, adapters, or catalogs.
 */

import { useCallback } from "react";
import { useI18n } from "./I18nProvider";
import { resolveMessage } from "./resolveMessage";
import type { AppLocale } from "./locale";
import type { MessageKey, MessageParams } from "./catalogs/types";

/** Active locale from context. */
export function useLocale(): AppLocale {
  return useI18n().locale;
}

/** Locale switcher writing through to persisted preference. */
export function useSetLocale(): (locale: AppLocale) => void {
  return useI18n().setLocale;
}

/** Memoized catalog translator (rebuilt only when the locale changes). */
export function useT(): (key: MessageKey, params?: MessageParams) => string {
  const { locale } = useI18n();
  return useCallback((key, params) => resolveMessage(locale, key, params), [locale]);
}
