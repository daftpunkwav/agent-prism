/**
 * @file URL validation tests
 * @description Covers SSRF protection across the url-validation module.
 *
 * Responsibilities:
 * - Reject metadata, reserved, and private targets and non-http(s) schemes
 * - Pin validateFetchUrl / validateWebsiteUrl / assertResolvedIpAllowed contracts
 * - Pin the loopback single source shared by URL policy and the listen guard
 */

import { describe, expect, it } from "vitest";
import {
  assertResolvedIpAllowed,
  isLoopbackHost,
  validateFetchUrl,
  validateLlmBaseUrl,
  validateWebsiteUrl,
  UrlValidationError,
} from "@agentprism/contracts";

function expectRejected(raw: string): void {
  expect(() => validateLlmBaseUrl(raw)).toThrow(UrlValidationError);
}

describe("validateLlmBaseUrl SSRF protection", () => {
  it("non-dotted IPv4 literals expand then hit network-range checks", () => {
    // 2852039166 = 169.254.169.254 (cloud metadata)
    expectRejected("https://2852039166/v1");
    // 0xA9FEA9FE = 169.254.169.254
    expectRejected("https://0xA9FEA9FE/v1");
  });

  it("private IPv4 and IPv6 ULA are rejected (https path)", () => {
    expectRejected("https://10.0.0.1/v1");
    expectRejected("https://172.16.0.5/v1");
    expectRejected("https://192.168.1.1/v1");
    expectRejected("https://100.64.0.1/v1");
    expectRejected("https://[fc00::1]/v1");
    expectRejected("https://[fe80::1]/v1");
  });

  it("loopback and public hosts are allowed", () => {
    expect(validateLlmBaseUrl("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434/v1");
    expect(validateLlmBaseUrl("http://localhost:8000/v1/")).toBe("http://localhost:8000/v1");
    expect(validateLlmBaseUrl("https://8.8.8.8/v1")).toBe("https://8.8.8.8/v1");
    expect(validateLlmBaseUrl("https://api.example.com/v1")).toBe("https://api.example.com/v1");
  });

  it("non-loopback http is rejected (existing policy)", () => {
    expectRejected("http://10.0.0.1/v1");
    expectRejected("http://api.example.com/v1");
  });

  it("empty address and non-http(s) schemes are rejected", () => {
    expectRejected("   ");
    expectRejected("ftp://example.com");
    expectRejected("file:///etc/passwd");
  });
});

describe("validateLlmBaseUrl ambiguous literal rejection (fail-closed SSRF)", () => {
  it("octal-looking dotted quads are rejected (resolvers may read them as private ranges)", () => {
    // 012.0.0.1 reads as 10.0.0.1 under inet_aton semantics while looking public as decimal
    expectRejected("https://012.0.0.1/v1");
    expectRejected("https://10.0.0.01/v1");
  });

  it("hex dotted-quad parts normalize then hit range checks", () => {
    // 0xA.0.0.1 normalizes to private 10.0.0.1 -> rejected
    expectRejected("https://0xA.0.0.1/v1");
    // 0x7f.0.0.1 normalizes to loopback 127.0.0.1 -> allowed like any loopback
    expect(validateLlmBaseUrl("https://0x7f.0.0.1/v1")).toBe("https://0x7f.0.0.1/v1");
  });

  it("plain dotted quads without leading zeros still pass range checks", () => {
    expect(validateLlmBaseUrl("https://8.8.8.8/v1")).toBe("https://8.8.8.8/v1");
    expectRejected("https://10.0.0.1/v1");
  });
});

describe("validateFetchUrl (model-supplied fetch targets)", () => {
  it("allows loopback, public IPs, public IPv6, and name hosts", () => {
    expect(validateFetchUrl("http://127.0.0.1:8080/x").hostname).toBe("127.0.0.1");
    expect(validateFetchUrl("https://8.8.8.8/").hostname).toBe("8.8.8.8");
    expect(validateFetchUrl("https://[2606:4700::1111]/").hostname).toBe("[2606:4700::1111]");
    expect(validateFetchUrl("https://api.example.com/x").hostname).toBe("api.example.com");
  });

  it("trims surrounding whitespace and returns the parsed URL", () => {
    expect(validateFetchUrl("  https://example.com/x  ").toString()).toBe("https://example.com/x");
  });

  it.each([
    "https://10.0.0.1/", // private
    "https://169.254.169.254/", // link-local metadata
    "https://0.0.0.0/", // unspecified / this-network
    "https://100.64.0.1/", // CGNAT lower bound
    "https://100.127.255.254/", // CGNAT upper bound
    "https://224.0.0.1/", // multicast
    "https://240.0.0.1/", // reserved
    "https://300.1.1.1/", // octet out of range
    "https://[::]/", // IPv6 unspecified
    "https://[fc00::1]/", // IPv6 ULA
    "https://[fe80::1]/", // IPv6 link-local
    "https://[ff02::1]/", // IPv6 multicast
    "https://[::ffff:10.0.0.1]/", // IPv4-mapped: fail closed at the string level
  ])("rejects forbidden target %s", (url) => {
    expect(() => validateFetchUrl(url)).toThrow(UrlValidationError);
  });

  it("allows public addresses just outside the CGNAT range", () => {
    expect(validateFetchUrl("https://100.63.0.1/").hostname).toBe("100.63.0.1");
    expect(validateFetchUrl("https://100.128.0.1/").hostname).toBe("100.128.0.1");
  });

  it("canonicalizes standard ambiguous quads via the URL parser, then range-checks them", () => {
    // WHATWG parsing turns "012.0.0.1" (octal 10) into 10.0.0.1 before the guard
    // sees it, so these fail the private-range check, not the ambiguity check.
    expect(() => validateFetchUrl("https://012.0.0.1/")).toThrow(/not allowed/);
    expect(() => validateFetchUrl("https://0xA.0.0.1/")).toThrow(/not allowed/);
  });

  it("rejects quads the URL parser leaves as names through the ambiguity backstop", () => {
    // A trailing letter keeps the host a name, so the octal-looking segment is
    // still visible at the string level and the backstop fires.
    expect(() => validateFetchUrl("https://012.0.0.1x/")).toThrow(/ambiguous/);
  });

  it("rejects metadata hostnames in any casing", () => {
    expect(() => validateFetchUrl("https://METADATA.Google.Internal/")).toThrow(UrlValidationError);
    expect(() => validateFetchUrl("https://Instance-Data/")).toThrow(UrlValidationError);
  });

  it("rejects empty, malformed, and scheme-less inputs", () => {
    expect(() => validateFetchUrl("")).toThrow(/must not be empty/);
    expect(() => validateFetchUrl("   ")).toThrow(UrlValidationError);
    expect(() => validateFetchUrl("not-a-url")).toThrow(/http or https/);
    expect(() => validateFetchUrl("ftp://example.com/")).toThrow(/http or https/);
    // "https://" parses as an Invalid URL, so it hits the scheme branch.
    expect(() => validateFetchUrl("https://")).toThrow(/http or https/);
  });

  it("surfaces the caller's field name in rejection messages", () => {
    expect(() => validateFetchUrl("https://10.0.0.1/", "fetch_url")).toThrow(/fetch_url/);
  });
});

describe("validateWebsiteUrl (optional profile field)", () => {
  it("passes an empty value through as empty", () => {
    expect(validateWebsiteUrl("")).toBe("");
    expect(validateWebsiteUrl("   ")).toBe("");
  });

  it("returns the trimmed input for allowed targets", () => {
    expect(validateWebsiteUrl("  https://example.com/page  ")).toBe("https://example.com/page");
  });

  it("rejects non-http schemes and forbidden targets", () => {
    expect(() => validateWebsiteUrl("javascript:alert(1)")).toThrow(UrlValidationError);
    expect(() => validateWebsiteUrl("http://169.254.169.254/")).toThrow(UrlValidationError);
    expect(() => validateWebsiteUrl("http://10.0.0.1/")).toThrow(UrlValidationError);
  });
});

describe("assertResolvedIpAllowed (post-DNS rebinding guard)", () => {
  it("allows public IPv4, public IPv6, and loopback", () => {
    expect(() => assertResolvedIpAllowed("93.184.216.34")).not.toThrow();
    expect(() => assertResolvedIpAllowed("2606:4700::1111")).not.toThrow();
    expect(() => assertResolvedIpAllowed("127.0.0.1")).not.toThrow();
    expect(() => assertResolvedIpAllowed("::1")).not.toThrow();
  });

  it.each([
    "10.0.0.1", // private
    "169.254.1.1", // link-local
    "0.0.0.0", // unspecified
    "100.64.0.9", // CGNAT
    "224.0.0.1", // multicast
    "240.0.0.1", // reserved
    "::", // IPv6 unspecified
    "fc00::1", // IPv6 ULA
    "fe80::1", // IPv6 link-local
    "ff02::1", // IPv6 multicast
    "::ffff:10.0.0.1", // IPv4-mapped: not recognized as loopback, fail closed
  ])("rejects resolved address %s", (ip) => {
    expect(() => assertResolvedIpAllowed(ip)).toThrow(UrlValidationError);
  });

  it("names the offending address and field in the message", () => {
    expect(() => assertResolvedIpAllowed("10.0.0.1", "fetch_url")).toThrow(
      /fetch_url resolves to a forbidden address \(10\.0\.0\.1\)/,
    );
  });
});

describe("DNS absolute-form (trailing dot) hosts", () => {
  it("normalizes the dot before denylist checks (dot-suffixed metadata host)", () => {
    // "metadata.google.internal." is the DNS absolute form of the denylisted name;
    // the URL parser keeps the dot on a name host, so the old string compare let it
    // through as an ordinary name host.
    expect(() => validateFetchUrl("https://metadata.google.internal./token")).toThrow(UrlValidationError);
    expect(() => validateFetchUrl("https://Instance-Data./")).toThrow(UrlValidationError);
    expect(() => validateLlmBaseUrl("https://METADATA.google.internal./v1")).toThrow(UrlValidationError);
    expect(() => validateWebsiteUrl("https://kubernetes.default./")).toThrow(UrlValidationError);
  });

  it("strips every trailing dot before the denylist checks (multi-dot absolute form)", () => {
    // Only one trailing dot is a valid DNS absolute form, but parsers accept runs of
    // them; a name host whose dots are not all stripped still resolves like the
    // denylisted name while passing the string compare.
    expect(() => validateFetchUrl("https://metadata.google.internal.../token")).toThrow(UrlValidationError);
    expect(() => validateFetchUrl("https://instance-data../")).toThrow(UrlValidationError);
    expect(() => validateLlmBaseUrl("https://kubernetes.default..../v1")).toThrow(UrlValidationError);
    expect(() => validateWebsiteUrl("https://METADATA.google.internal../")).toThrow(UrlValidationError);
  });

  it("keeps loopback local endpoints usable in the absolute form", () => {
    // The same normalization is what makes the http-loopback allowance recognize
    // the FQDN spelling instead of rejecting it as a non-loopback name host.
    expect(validateLlmBaseUrl("http://localhost.:8000/v1")).toBe("http://localhost.:8000/v1");
    expect(validateLlmBaseUrl("http://127.0.0.1.:11434/v1")).toBe("http://127.0.0.1.:11434/v1");
    expect(validateLlmBaseUrl("http://localhost...:8000/v1")).toBe("http://localhost...:8000/v1");
    expect(validateFetchUrl("http://localhost.../x").hostname).toBe("localhost...");
  });

  it("still accepts public names and addresses in the absolute form", () => {
    expect(validateFetchUrl("https://example.com./x").hostname).toBe("example.com.");
    expect(validateFetchUrl("https://8.8.8.8./").hostname).toBe("8.8.8.8");
  });
});

describe("isLoopbackHost (shared single source)", () => {
  it.each(["localhost", "LOCALHOST", "127.0.0.1", "::1", "[::1]"])("accepts %s", (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each(["localhost.", "LOCALHOST..", "127.0.0.1.", "[::1].", "::1."])(
    "accepts the DNS absolute form %s",
    (host) => {
      // The runtime listen guard calls this directly with the configured bind host,
      // so the FQDN spelling must classify exactly like its dotless form.
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each(["example.com", "127.0.0.2", "::2", "::ffff:127.0.0.1", "localhost.example.com", ""])(
    "rejects %s",
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    },
  );

  it.each(["localhost.example.com.", "127.0.0.2.", "...", "."])("rejects absolute-form %s", (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});
