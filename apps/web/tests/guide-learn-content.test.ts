/**
 * @file guide/learn content tests
 * @description Locks the static content registries: locale selection, en/zh-CN shape parity, non-empty leaves.
 *
 * The en modules are compile-checked against the zh-CN types; this locks the
 * same contract at runtime so partially translated trees cannot ship.
 */

import { describe, expect, it } from "vitest";
import { selectGuideContent } from "../src/i18n/content/guide/index.js";
import { selectLearnContent } from "../src/i18n/content/learn/index.js";

/** Collects the sorted paths of all string leaves in a plain data tree. */
function stringLeafPaths(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") return [prefix];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => stringLeafPaths(item, `${prefix}[${index}]`));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
      stringLeafPaths(item, prefix === "" ? key : `${prefix}.${key}`),
    );
  }
  return [];
}

function readPath(root: unknown, path: string): unknown {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], root);
}

describe("guide content registry", () => {
  it("selects a distinct content module per locale", () => {
    const zh = selectGuideContent("zh-CN");
    const en = selectGuideContent("en");
    expect(zh).toBeDefined();
    expect(en).toBeDefined();
    expect(en).not.toBe(zh);
  });

  it("keeps en and zh-CN on exactly the same string-leaf key set", () => {
    const zh = stringLeafPaths(selectGuideContent("zh-CN"));
    const en = stringLeafPaths(selectGuideContent("en"));
    expect(en).toEqual(zh);
  });

  it("carries non-empty text in both locales", () => {
    for (const locale of ["zh-CN", "en"] as const) {
      const content = selectGuideContent(locale);
      for (const path of stringLeafPaths(content)) {
        expect(readPath(content, path) as string, path).not.toMatch(/^\s*$/);
      }
    }
  });

  it("ships a hero and at least one documented section per locale", () => {
    for (const locale of ["zh-CN", "en"] as const) {
      const content = selectGuideContent(locale);
      expect(content.hero.title, locale).toBeTypeOf("string");
      expect(content.overviewSections.length, locale).toBeGreaterThan(0);
    }
  });
});

describe("learn content registry", () => {
  it("selects a distinct content module per locale", () => {
    const zh = selectLearnContent("zh-CN");
    const en = selectLearnContent("en");
    expect(en).not.toBe(zh);
  });

  it("keeps en and zh-CN on exactly the same string-leaf key set", () => {
    const zh = stringLeafPaths(selectLearnContent("zh-CN"));
    const en = stringLeafPaths(selectLearnContent("en"));
    expect(en).toEqual(zh);
  });

  it("carries non-empty text and a non-empty week plan in both locales", () => {
    for (const locale of ["zh-CN", "en"] as const) {
      const content = selectLearnContent(locale);
      expect(content.page.title.trim().length, locale).toBeGreaterThan(0);
      expect(content.weekPlan.length, locale).toBeGreaterThan(0);
      for (const path of stringLeafPaths(content)) {
        expect(readPath(content, path) as string, path).not.toMatch(/^\s*$/);
      }
    }
  });
});
