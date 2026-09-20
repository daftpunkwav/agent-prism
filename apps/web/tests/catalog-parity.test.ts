/**
 * @file catalog parity tests
 * @description Locks en/zh-CN catalog key parity and non-empty values.
 */

import { describe, expect, it } from "vitest";
import { getCatalog } from "../src/i18n/catalogs";
import { en } from "../src/i18n/catalogs/en";
import { zhCN } from "../src/i18n/catalogs/zh-CN";

describe("catalog key parity", () => {
  function flatten(catalog: unknown, prefix = ""): string[] {
    const keys: string[] = [];
    for (const [key, value] of Object.entries(catalog as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === "string") {
        keys.push(path);
      } else {
        keys.push(...flatten(value, path));
      }
    }
    return keys.sort();
  }

  it("en covers exactly the same key set as zh-CN", () => {
    expect(flatten(en)).toEqual(flatten(zhCN));
  });

  it("every catalog value is a non-empty string", () => {
    for (const key of flatten(zhCN)) {
      const value = key.split(".").reduce<unknown>(
        (node, part) => (node as Record<string, unknown>)[part],
        getCatalog("zh-CN"),
      );
      expect(value, key).toBeTypeOf("string");
      expect(value as string, key).not.toBe("");
    }
  });
});
