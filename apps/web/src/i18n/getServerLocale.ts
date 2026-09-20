/**
 * @file getServerLocale
 * @description Server-side locale resolution for the root layout.
 *
 * Responsibilities:
 * - Resolve html lang, metadata, and provider initial value
 *
 * Reads the mirror cookie through the LocaleAdapter port so the rules stay
 * in one place.
 */

import { headers } from "next/headers";
import { storageCookieAdapter } from "./adapters/storageCookieAdapter";
import { normalizeLocale, type AppLocale } from "./locale";

/** Server-resolved locale from the persisted cookie (hydration source). */
export async function getServerLocale(): Promise<AppLocale> {
  const headerList = await headers();
  return normalizeLocale(storageCookieAdapter.readServer(headerList.get("cookie") ?? undefined));
}
