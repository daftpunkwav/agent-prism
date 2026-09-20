/**
 * @file locale normalize tests
 * @description Locks canonicalization: aliases, whitespace, and default-locale fallback.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, normalizeLocale } from "../src/i18n/locale.js";

describe("normalizeLocale", () => {
  it("accepts canonical locales", () => {
    expect(normalizeLocale("zh-CN")).toBe("zh-CN");
    expect(normalizeLocale("en")).toBe("en");
  });

  it("maps documented aliases", () => {
    expect(normalizeLocale("zh")).toBe("zh-CN");
    expect(normalizeLocale("zh-Hans")).toBe("zh-CN");
    expect(normalizeLocale("zh_CN")).toBe("zh-CN");
    expect(normalizeLocale("en-US")).toBe("en");
    expect(normalizeLocale("en-GB")).toBe("en");
  });

  it("falls back to the default locale on empty/missing/unknown input", () => {
    expect(normalizeLocale(null)).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale("")).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale("   ")).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale("fr")).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale("ZH-cn")).toBe(DEFAULT_LOCALE);
  });
});

