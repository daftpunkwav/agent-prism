/**
 * @file content/learn/index
 * @description Maps an AppLocale to its learn content module.
 *
 * Responsibilities:
 * - Registry entry point; adding a locale means one entry plus its module
 *
 * Mirrors the catalogs registry; zh-CN is the source of truth and en is
 * compile-checked against it.
 */

import type { AppLocale } from "../../locale";
import { learnContent as zhCN, type LearnContent } from "./zh-CN";
import { learnContent as en } from "./en";

const CONTENT: Readonly<Record<AppLocale, LearnContent>> = {
  "zh-CN": zhCN,
  en,
};

/** Selects the learn content module for a locale. */
export function selectLearnContent(locale: AppLocale): LearnContent {
  return CONTENT[locale];
}

export type { WeekStep } from "./types";
export type { LearnContent } from "./zh-CN";
