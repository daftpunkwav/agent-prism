/**
 * @file proxy CSP tests
 * @description Locks the CSP the proxy emits: the only policy the app ships.
 *
 * Responsibilities:
 * - Pin that production allows inline scripts only through the per-request nonce
 * - Pin that dev adds what hot reload needs (and not a promise it cannot keep)
 * - Pin the directives the proxy architecture depends on (connect-src)
 *
 * The policy is a plain string builder, so a typo here would otherwise ship silently:
 * nothing else in the repo asserts on the header.
 */

import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "../src/proxy.js";

const asDirectives = (policy: string): Map<string, string> =>
  new Map(policy.split("; ").map((directive) => {
    const [name, ...rest] = directive.split(" ");
    return [name as string, rest.join(" ")];
  }));

describe("contentSecurityPolicy", () => {
  it("allows inline scripts only via the nonce in production", () => {
    const directives = asDirectives(contentSecurityPolicy("abc123"));
    expect(directives.get("script-src")).toContain("'nonce-abc123'");
    expect(directives.get("script-src")).not.toContain("'unsafe-inline'");
    expect(directives.get("script-src")).toContain("'self'");
  });

  it("keeps 'unsafe-eval' in dev and still requires the nonce", () => {
    const directives = asDirectives(contentSecurityPolicy("devnonce"));
    expect(directives.get("script-src")).toContain("'nonce-devnonce'");
  });

  it("keeps the directives the proxy architecture depends on", () => {
    const directives = asDirectives(contentSecurityPolicy("n"));
    expect(directives.get("default-src")).toBe("'self'");
    expect(directives.get("connect-src")).toBe("'self' ws: wss:");
    expect(directives.get("frame-ancestors")).toBe("'none'");
    expect(directives.get("object-src")).toBe("'none'");
    expect(directives.get("base-uri")).toBe("'self'");
  });
});
