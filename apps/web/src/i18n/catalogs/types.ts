/**
 * @file catalogs/types
 * @description The MessageCatalog contract keeping locales structurally identical.
 *
 * Responsibilities:
 * - Define the catalog shape derived from the zh-CN source of truth
 *
 * en is annotated against it, so a missing or extra key fails compilation
 * instead of shipping a half translation.
 */

import type { zhCN } from "./zh-CN";

/** Any catalog (currently zh-CN and en share this exact shape). */
export type MessageCatalog = typeof zhCN;

/** Dot-separated key paths over a catalog, e.g. "shell.nav.arena". */
export type MessageKey = DotPaths<MessageCatalog>;

type DotPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${DotPaths<T[K]>}`;
}[keyof T & string];

/** Values usable for {placeholder} interpolation inside catalog strings. */
export type MessageParams = Record<string, string | number>;
