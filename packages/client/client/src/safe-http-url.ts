/**
 * @file safe-http-url
 * @description http(s)-only external link helper blocking javascript: XSS.
 *
 * Responsibilities:
 * - Delegate scheme validation to the contract layer's unified validator
 */

import { validateWebsiteUrl } from "@agentprism/contracts";

/** Returns the normalized http(s) URL, or null when rejected (never throws). */
export function safeHttpUrl(raw: string): string | null {
  try {
    const result = validateWebsiteUrl(raw);
    // validateWebsiteUrl only throws UrlValidationError; anything rejected maps to null.
    return result === "" ? null : result;
  } catch {
    return null;
  }
}
