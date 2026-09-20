/**
 * @file url-validation
 * @description Safe URL validation (pure, no IO) against SSRF.
 *
 * Responsibilities:
 * - Reject non-http(s) schemes, missing hostnames, and metadata addresses
 * - Reject reserved/link-local/private IP ranges; http only for loopback
 * - Expose fetch-target validation for IO layers to call before and after
 *   DNS resolution (the string-level check cannot see rebinding)
 */

const DENYLIST_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.google.com",
  "instance-data",
  "kubernetes.default",
  "kubernetes.default.svc",
]);

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Loopback in any accepted spelling (bare/bracketed host, with or without brackets stripped).
 * Single source for loopback checks (URL policy and the runtime listen guard share it).
 */
export function isLoopbackHost(hostname: string): boolean {
  const lowered = hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(lowered) || LOOPBACK_HOSTS.has(hostname.replace(/^\[|\]$/g, "").toLowerCase());
}

/** Rejected website URL (non-http(s) scheme, traversal, or malformed host). */
export class UrlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlValidationError";
  }
}

/** 32-bit integer → dotted IPv4; returns null when out of range. */
function u32ToDotted(value: number): string | null {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) return null;
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

/** Expands non-dotted IPv4 literals (plain decimal / 0x hex); returns null for non-literals. */
function expandNumericIpv4(hostname: string): string | null {
  if (/^\d+$/.test(hostname)) return u32ToDotted(Number(hostname));
  const hex = /^0x([0-9a-f]+)$/i.exec(hostname);
  if (hex !== null) return u32ToDotted(Number.parseInt(hex[1] ?? "", 16));
  return null;
}

function parseHost(hostname: string): { kind: "name" | "ipv4" | "ipv6"; value: string } {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return { kind: "ipv6", value: hostname.slice(1, -1) };
  }
  // IP literals must go through IP-range checks so no literal form slips through as a "name host".
  const numeric = expandNumericIpv4(hostname);
  if (numeric !== null) return { kind: "ipv4", value: numeric };
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return { kind: "ipv4", value: hostname };
  return { kind: "name", value: hostname };
}

/**
 * Dotted quads resolvers may read as octal/hex (e.g. "012.0.0.1" as 10.0.0.1,
 * "0xA.0.0.1" likewise) while the range check above sees decimal digits or a plain
 * name — a private target slipping through as public. Fail closed: no legitimate
 * base URL or website link uses such spellings.
 */
function isAmbiguousIpv4Literal(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;
  return parts.some((part) => /^0\d+$/.test(part) || /^0x[0-9a-f]+$/i.test(part));
}

/** Whether a literal IP falls in a forbidden range (loopback allowed). */
function isForbiddenIp(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const octets = v4.slice(1).map((part) => Number(part));
    if (octets.some((n) => n > 255)) return true;
    const [a, b] = octets as [number, number, number, number];
    if (a === 127) return false; // loopback allowed
    if (a === 169 && b === 254) return true; // link-local
    if (a === 0) return true; // unspecified / this-network
    if (a === 10) return true; // private range
    if (a === 172 && b >= 16 && b <= 31) return true; // private range
    if (a === 192 && b === 168) return true; // private range
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT reserved range
    if (a >= 224 && a <= 239) return true; // multicast
    if (a >= 240) return true; // reserved
    return false;
  }
  // IPv6 literal
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return lower === "::"; // unspecified denied, loopback allowed
    const firstHextet = Number.parseInt(lower.split(":")[0] ?? "", 16);
    if (Number.isNaN(firstHextet)) return true;
    if ((firstHextet & 0xff00) === 0xfe00) return true; // fe80::/10 link-local
    if ((firstHextet & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA private range
    if ((firstHextet & 0xff00) === 0x0000 && lower !== "::1") return true; // ::/8 reserved range
    return false;
  }
  return true;
}

function parseHttpUrl(rawUrl: string, field: string): URL {
  if (rawUrl.trim() === "") {
    throw new UrlValidationError(`${field} must not be empty`);
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UrlValidationError(`${field} must use http or https`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UrlValidationError(`${field} must use http or https`);
  }
  if (parsed.hostname === "") {
    throw new UrlValidationError(`${field} is missing a hostname`);
  }
  return parsed;
}

function assertHostAllowed(parsed: URL, field: string): void {
  if (isAmbiguousIpv4Literal(parsed.hostname)) {
    throw new UrlValidationError(`${field} IP literal has an ambiguous (octal/hex) form`);
  }
  const host = parseHost(parsed.hostname);
  const normalized = host.value.toLowerCase();
  if (DENYLIST_HOSTS.has(normalized) || DENYLIST_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new UrlValidationError(`${field} hostname is not allowed`);
  }
  const isLoopback = isLoopbackHost(parsed.hostname) || isLoopbackHost(normalized);
  if (host.kind === "name") {
    if (isLoopback) return;
    // Name hosts are allowed (DNS resolution is not validated here)
    return;
  }
  if (isLoopback) return;
  if (isForbiddenIp(host.value)) {
    throw new UrlValidationError(`${field} target address is not allowed`);
  }
}

/** Validates an external website link; empty strings pass (optional field). Returns the trimmed input. */
export function validateWebsiteUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (trimmed === "") return "";
  const parsed = parseHttpUrl(trimmed, "website_url");
  assertHostAllowed(parsed, "website_url");
  return trimmed;
}

/** Validates the LLM request base URL; required, http allowed only for loopback. Returns the value with trailing slashes stripped. */
export function validateLlmBaseUrl(rawUrl: string): string {
  if (rawUrl.trim() === "") {
    throw new UrlValidationError("base_url must not be empty");
  }
  const parsed = parseHttpUrl(rawUrl.trim(), "base_url");
  assertHostAllowed(parsed, "base_url");
  if (parsed.protocol === "http:") {
    // Bracket-stripped compare: URL keeps IPv6 brackets in hostname, so "[::1]" must count.
    if (!isLoopbackHost(parseHost(parsed.hostname).value)) {
      throw new UrlValidationError("http base_url is only allowed for localhost / 127.0.0.1 / ::1");
    }
  }
  return rawUrl.trim().replace(/\/+$/, "");
}

/** Validates a model-supplied fetch target (http/https, allowed host). Returns the parsed URL. */
export function validateFetchUrl(rawUrl: string, field = "url"): URL {
  const parsed = parseHttpUrl(rawUrl.trim(), field);
  assertHostAllowed(parsed, field);
  return parsed;
}

/**
 * Re-validates one DNS-resolved address at fetch time: a name host that passed
 * the string-level check may still resolve into a forbidden range (rebinding).
 * Loopback stays allowed, matching the name-host policy above.
 */
export function assertResolvedIpAllowed(ip: string, field = "url"): void {
  if (isForbiddenIp(ip)) {
    throw new UrlValidationError(`${field} resolves to a forbidden address (${ip})`);
  }
}
