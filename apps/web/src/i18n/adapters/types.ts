/**
 * @file adapters/types
 * @description The port answering where the locale comes from and is written.
 *
 * Responsibilities:
 * - Define the LocaleAdapter read/write contract
 *
 * Swapping the strategy (e.g. a future URL-segment scheme) means adding an
 * adapter, never touching components.
 */

import type { AppLocale } from "../locale";

export type LocaleAdapter = {
  /** Client-side read (localStorage); returns null when unavailable (privacy mode etc.). */
  readClient(): string | null;
  /** Server-side read from a raw Cookie header; returns null when absent. */
  readServer(cookieHeader?: string): string | null;
  /** Client-side write of the canonical locale to storage + cookie. */
  write(locale: AppLocale): void;
};
