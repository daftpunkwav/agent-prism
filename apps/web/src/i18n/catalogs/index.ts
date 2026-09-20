/**
 * @file catalogs/index
 * @description Maps an AppLocale to its merged message catalog.
 *
 * Responsibilities:
 * - Enumerate catalog files; adding a locale means adding one entry
 */

import { en } from "./en";
import { zhCN } from "./zh-CN";
import type { AppLocale } from "../locale";
import type { MessageCatalog } from "./types";

const CATALOGS: Readonly<Record<AppLocale, MessageCatalog>> = {
  "zh-CN": zhCN,
  en,
};

/** Returns the merged message catalog for a supported locale. */
export function getCatalog(locale: AppLocale): MessageCatalog {
  return CATALOGS[locale];
}
