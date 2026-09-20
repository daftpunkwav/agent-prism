/**
 * @file content/guide/index
 * @description Maps an AppLocale to its guide content module.
 *
 * Responsibilities:
 * - Registry entry point; adding a locale means one entry plus its module
 *
 * Mirrors the catalogs registry; zh-CN is the source of truth and en is
 * compile-checked against it.
 */

import type { AppLocale } from "../../locale";
import { guideContent as zhCN, type GuideContent } from "./zh-CN";
import { guideContent as en } from "./en";

const CONTENT: Readonly<Record<AppLocale, GuideContent>> = {
  "zh-CN": zhCN,
  en,
};

/** Selects the guide content module for a locale. */
export function selectGuideContent(locale: AppLocale): GuideContent {
  return CONTENT[locale];
}

export type { Reality, DimDoc, GuideBlock, GuideSection, GuideHero, GuideHeroAction } from "./types";
export type { GuideContent } from "./zh-CN";
