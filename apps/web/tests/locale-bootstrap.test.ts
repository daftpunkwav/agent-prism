/**
 * @file locale bootstrap tests
 * @description Locks pre-paint parity: the inline snippet agrees with normalizeLocale and embeds storage keys.
 */

import { describe, expect, it } from "vitest";
import { normalizeLocale } from "../src/i18n/locale.js";
import { LOCALE_PICK_SNIPPET, localeBootstrapScript } from "../src/i18n/bootstrapScript.js";
import { LOCALE_COOKIE_NAME, LOCALE_STORAGE_KEY } from "../src/i18n/constants.js";

describe("pre-paint pick() parity", () => {
  const makePick = new Function(
    `${LOCALE_PICK_SNIPPET}; return __pickLocale;`,
  ) as () => (raw: string | null | undefined) => string;
  const pick = makePick();

  /** Shared decision table — any new alias/rule must appear here for both implementations. */
  const table: Array<[string | null | undefined, string]> = [
    ["zh-CN", "zh-CN"],
    ["en", "en"],
    ["zh", "zh-CN"],
    ["zh-Hans", "zh-CN"],
    ["zh_CN", "zh-CN"],
    ["en-US", "en"],
    ["en-GB", "en"],
    ["  en  ", "en"],
    ["fr", "en"],
    ["ZH-CN", "en"],
    ["", "en"],
    ["   ", "en"],
    [null, "en"],
    [undefined, "en"],
  ];

  it("matches normalizeLocale on the shared decision table", () => {
    for (const [input, expected] of table) {
      expect(pick(input)).toBe(expected);
      expect(normalizeLocale(input)).toBe(expected);
    }
  });

  it("embeds the storage key and writes the mirror cookie", () => {
    expect(localeBootstrapScript).toContain(LOCALE_STORAGE_KEY);
    expect(localeBootstrapScript).toContain(LOCALE_COOKIE_NAME);
    expect(localeBootstrapScript).toContain("data-locale");
  });
});

