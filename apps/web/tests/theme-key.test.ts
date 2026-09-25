// @vitest-environment jsdom
/**
 * @file theme key tests
 * @description Pins the theme/skin persistence contract: storage keys shared by the
 *              layout inline scripts and the toggles, and the skin registry behavior.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getCatalog } from "../src/i18n/catalogs";
import {
  DEFAULT_SKIN,
  SKINS,
  SKIN_STORAGE_KEY,
  THEME_STORAGE_KEY,
  applySkin,
  normalizeSkin,
} from "../src/theme.js";

describe("THEME_STORAGE_KEY", () => {
  it("keeps the persistence key that both sides read", () => {
    // The literal is the storage contract: renaming it would orphan saved preferences.
    expect(THEME_STORAGE_KEY).toBe("agentprism-theme");
  });
});

describe("SKIN_STORAGE_KEY", () => {
  it("keeps the skin persistence key that the layout inline script reads", () => {
    expect(SKIN_STORAGE_KEY).toBe("agentprism-skin");
  });
});

describe("skin registry", () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });

  it("registers every shipped skin exactly once, default first", () => {
    expect(SKINS[0]).toBe(DEFAULT_SKIN);
    expect(new Set(SKINS).size).toBe(SKINS.length);
    // The explicit list pins picker order; the tests below cross-check the CSS
    // files and the picker labels against this registry.
    expect(SKINS).toEqual([
      "21th",
      "claude",
      "apple",
      "google",
      "tiktok",
      "nerv",
      "motion-fit",
      "minimalist",
      "goldentime",
      "vibecamp",
      "vercel",
    ]);
  });

  it("has a self-contained CSS file per non-default skin, imported by the registry", () => {
    // Vitest runs from the repo root (root vitest.config.ts), so the shared ui
    // package styles resolve from there.
    const skinsDir = resolve(process.cwd(), "packages/ui/ui/styles/skins");
    const registry = readFileSync(join(skinsDir, "index.css"), "utf8");
    for (const skin of SKINS) {
      if (skin === DEFAULT_SKIN) continue;
      // The registry must import the file, and the file must target the id.
      expect(registry).toContain(`@import "./${skin}.css"`);
      const css = readFileSync(join(skinsDir, `${skin}.css`), "utf8");
      expect(css).toContain(`[data-theme="${skin}"]`);
    }
  });

  it("gives every registered skin a picker label in both locales", () => {
    // A registered id without a settings.skin.<id> label would render the raw
    // key path in the picker (resolveMessage degrades to the key in production).
    for (const locale of ["en", "zh-CN"] as const) {
      const labels = getCatalog(locale).settings.skin;
      for (const skin of SKINS) {
        expect(labels[skin], `${locale}.settings.skin.${skin}`).toBeTypeOf("string");
        expect(labels[skin], `${locale}.settings.skin.${skin}`).not.toBe("");
      }
    }
  });

  it("normalizes unknown and empty stored values to the default skin", () => {
    expect(normalizeSkin(null)).toBe("21th");
    expect(normalizeSkin(undefined)).toBe("21th");
    expect(normalizeSkin("")).toBe("21th");
    expect(normalizeSkin("does-not-exist")).toBe("21th");
    expect(normalizeSkin("nerv")).toBe("nerv");
  });

  it("applySkin lands registered ids on <html data-theme> and clears the default", () => {
    applySkin("nerv");
    expect(document.documentElement.dataset.theme).toBe("nerv");
    applySkin("21th");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("applySkin falls back to the default skin for unknown values", () => {
    applySkin("no-such-skin");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
