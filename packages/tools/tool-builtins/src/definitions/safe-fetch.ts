/**
 * @file tools/safe-fetch
 * @description SSRF-guarded fetch shared by web_fetch and the MCP fetch server.
 *
 * Responsibilities:
 * - Validate the URL (scheme + host) and re-validate every DNS-resolved address
 * - Follow redirects manually, re-validating every hop against the same guards
 * - Read response bodies through a hard char cap (bounded memory)
 * - Resolve the body charset (BOM > header > meta sniff) before decoding
 *
 * Single source for outbound fetch policy: the string-level check cannot see
 * DNS rebinding, and redirect:"follow" would bypass any first-hop check, so
 * every fetch goes through this loop instead of a bare global fetch.
 */

import { lookup } from "node:dns/promises";
import { assertResolvedIpAllowed, UrlValidationError, validateFetchUrl } from "@agentprism/contracts";

/** Redirect hops allowed before the fetch fails; every hop is re-validated. */
export const SAFE_FETCH_MAX_REDIRECTS = 5;
/** Raw body cap in chars; bounds memory before any caller-side truncation. */
export const SAFE_FETCH_MAX_CHARS = 512 * 1024;
/** Bytes inspected for a charset declaration (BOM, meta tag, XML declaration). */
export const CHARSET_SNIFF_BYTES = 2048;

/** Result of a guarded fetch: the final response plus its capped body text. */
export interface SafeFetchResult {
  response: Response;
  /** Response body, read through the char cap (empty for unread responses). */
  text: string;
}

export interface SafeFetchOptions {
  signal: AbortSignal;
  headers?: Record<string, string>;
  /** Raw body cap in chars (default SAFE_FETCH_MAX_CHARS). */
  maxChars?: number;
}

/**
 * Resolves the TextDecoder label for a body: BOM first, then the Content-Type
 * charset parameter, then a meta/XML declaration sniffed in the first bytes.
 * Charset declarations are ASCII, so scanning a byte-wise projection of the
 * prefix is safe even when the body itself is encoded in GBK or similar.
 * Unknown or unsupported labels fall back to UTF-8.
 */
export function resolveCharset(contentType: string | null | undefined, prefix: Uint8Array): string {
  if (prefix.length >= 3 && prefix[0] === 0xef && prefix[1] === 0xbb && prefix[2] === 0xbf) return "utf-8";
  if (prefix.length >= 2 && prefix[0] === 0xff && prefix[1] === 0xfe) return "utf-16le";
  if (prefix.length >= 2 && prefix[0] === 0xfe && prefix[1] === 0xff) return "utf-16be";
  const fromHeader = /charset\s*=\s*"?([\w-]+)"?/i.exec(contentType ?? "")?.[1];
  if (fromHeader !== undefined) return normalizeCharset(fromHeader);
  let ascii = "";
  for (const byte of prefix.subarray(0, CHARSET_SNIFF_BYTES)) ascii += String.fromCharCode(byte);
  const declared =
    /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(ascii)?.[1] ??
    /<\?xml[^>]+encoding\s*=\s*["']([\w-]+)/i.exec(ascii)?.[1];
  return declared === undefined ? "utf-8" : normalizeCharset(declared);
}

/** Validates the label against the runtime's supported encodings; unknown labels fall back to UTF-8. */
function normalizeCharset(label: string): string {
  const candidate = label.trim().toLowerCase();
  try {
    new TextDecoder(candidate);
    return candidate;
  } catch {
    return "utf-8";
  }
}

/**
 * Reads a response body up to maxChars characters, cancelling the download early
 * when the cap is reached. The charset is decided once from the first chunk, then
 * the whole body streams through one decoder, keeping multi-byte sequences that
 * split across chunk boundaries intact. Falls back to response.text() when
 * streaming is unavailable (that path always assumes UTF-8).
 */
export async function readBodyCapped(response: Response, maxChars: number, signal: AbortSignal): Promise<string> {
  const body = response.body;
  if (body === null || typeof body.getReader !== "function") {
    return (await response.text()).slice(0, maxChars);
  }
  const reader = body.getReader();
  try {
    const first = await reader.read();
    if (first.done) return "";
    const prefix = first.value ?? new Uint8Array();
    const decoder = new TextDecoder(resolveCharset(response.headers.get("content-type"), prefix));
    let text = decoder.decode(prefix, { stream: true });
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.length >= maxChars) {
        await reader.cancel().catch(() => {});
        break;
      }
      if (signal.aborted) {
        // Same release as the cap path: a dangling download would pin the socket until GC.
        await reader.cancel().catch(() => {});
        break;
      }
    }
    text += decoder.decode();
    return text.slice(0, maxChars);
  } finally {
    reader.releaseLock();
  }
}

/** Re-validates every resolved address; DNS lookup failures surface at fetch time instead. */
async function assertResolvableAllowed(url: URL): Promise<void> {
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    return;
  }
  for (const { address } of addresses) assertResolvedIpAllowed(address, "url");
}

/**
 * Fetches a URL under the SSRF guard: string validation, DNS-resolution
 * re-validation, manual redirects with per-hop re-validation, and a hard body
 * cap. Throws UrlValidationError for policy failures (callers map those to
 * their own tool-result shape); network errors and non-2xx/3xx responses are
 * returned/propagated untouched so callers keep their existing error text.
 */
export async function safeFetchText(rawUrl: string, options: SafeFetchOptions): Promise<SafeFetchResult> {
  const maxChars = options.maxChars ?? SAFE_FETCH_MAX_CHARS;
  let target = validateFetchUrl(rawUrl);
  for (let hop = 0; ; hop += 1) {
    await assertResolvableAllowed(target);
    const response = await fetch(target, {
      signal: options.signal,
      redirect: "manual",
      headers: options.headers,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (location !== null) {
        if (hop >= SAFE_FETCH_MAX_REDIRECTS) {
          throw new UrlValidationError(`url exceeded ${SAFE_FETCH_MAX_REDIRECTS} redirects`);
        }
        target = validateFetchUrl(new URL(location, target).href);
        continue;
      }
      // 3xx without a location: hand it to the caller as a terminal response.
      return { response, text: "" };
    }
    const text = response.ok ? await readBodyCapped(response, maxChars, options.signal) : "";
    return { response, text };
  }
}
