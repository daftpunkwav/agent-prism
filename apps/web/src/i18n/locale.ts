/**
 * @file i18n/locale
 * @description The AppLocale contract: supported locales, default, normalization.
 *
 * Responsibilities:
 * - Define the locale union, aliases, and native labels
 * - Normalize arbitrary input to a supported locale
 *
 * Pure data and functions only — no storage access, no UI. Adding a language
 * starts here, then catalogs/content (see i18n/README.md).
 */

/** BCP 47 application locales. Extending this union triggers exhaustive checks everywhere. */
export type AppLocale = "zh-CN" | "en";

/** Default UI locale for first visit / unknown stored values. */
export const DEFAULT_LOCALE: AppLocale = "en";

export const SUPPORTED_LOCALES: readonly AppLocale[] = ["en", "zh-CN"];

/**
 * Endonyms for the language toggle (intrinsic self-names, not translated chrome).
 * zh-CN uses a Unicode escape so non-i18n source stays ASCII while the UI still shows the endonym.
 */
export const LOCALE_NATIVE_LABELS: Readonly<Record<AppLocale, string>> = {
  en: "English",
  "zh-CN": "\u4e2d\u6587", // Chinese
};

/** Accepted alias → canonical locale. Storage/cookies only ever hold canonical values. */
const LOCALE_ALIASES: Readonly<Record<string, AppLocale>> = {
  zh: "zh-CN",
  "zh-Hans": "zh-CN",
  zh_CN: "zh-CN",
  "en-US": "en",
  "en-GB": "en",
};

/** Narrows unknown values to the two supported locales. */
export function isAppLocale(value: unknown): value is AppLocale {
  return value === "zh-CN" || value === "en";
}

/** Dev-only, warn at most once per unrecognized raw value. */
const warnedUnknown = new Set<string>();

/**
 * Normalizes any raw stored/read value into a supported locale:
 * null/empty → default, exact match first, then aliases, else default.
 * Must stay behavior-identical to the inline pick() in bootstrapScript.ts
 * (locked by apps/web/tests/locale-normalize.test.ts + locale-bootstrap.test.ts).
 */
export function normalizeLocale(raw: string | null | undefined): AppLocale {
  if (raw == null) return DEFAULT_LOCALE;
  const value = raw.trim();
  if (value === "") return DEFAULT_LOCALE;
  if (isAppLocale(value)) return value;
  const alias = LOCALE_ALIASES[value];
  if (alias) return alias;
  if (process.env.NODE_ENV !== "production" && !warnedUnknown.has(value)) {
    warnedUnknown.add(value);
    console.warn(`[i18n] Unknown locale "${value}", falling back to ${DEFAULT_LOCALE}`);
  }
  return DEFAULT_LOCALE;
}
