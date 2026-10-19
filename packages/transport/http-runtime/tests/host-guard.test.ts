/**
 * @file host guard tests
 * @description Locks the DNS-rebinding Host guard: loopback binds reject foreign
 *   Host headers while loopback/allowlisted/absent hosts pass, and non-loopback
 *   binds disable the guard entirely.
 */

import { describe, expect, it } from "vitest";
import { createHttpApplication, type HttpApplicationDeps } from "../src/http-app.js";

function testApp(overrides: Partial<HttpApplicationDeps["settings"]> = {}) {
  const settings = {
    corsOrigins: "",
    frontendPort: 3000,
    apiToken: "",
    maxRequestSize: 1024 * 1024,
    backendHost: "127.0.0.1",
    backendPort: 8281,
    maxConcurrentRuns: 2,
    ...overrides,
  };
  const deps = {
    settings,
    // No domain routes: the guard is exercised through 404s, so the response
    // status is the guard's verdict (403) or its absence (404).
  } as unknown as HttpApplicationDeps;
  return createHttpApplication(deps);
}

function getWithHost(path: string, host: string | undefined) {
  return testApp().request(path, {
    headers: host === undefined ? {} : { host },
  });
}

describe("loopback host guard", () => {
  it("rejects a foreign Host header on a loopback bind (rebinding signature)", async () => {
    const res = await getWithHost("/api/sessions", "evil.example.com");
    expect(res.status).toBe(403);
    await expect(res.json() as Promise<{ detail: string }>).resolves.toMatchObject({
      detail: /host/i,
    });
  });

  it("allows loopback and bracketed IPv6 Host headers regardless of port", async () => {
    for (const host of ["localhost:3000", "127.0.0.1:8281", "[::1]:8281", "LOCALHOST:3000"]) {
      const res = await getWithHost("/api/sessions", host);
      expect(res.status, host).toBe(404);
    }
  });

  it("allows the operator-declared CORS frontend origin host", async () => {
    const app = testApp({ corsOrigins: "http://myhost.local:3000" });
    const res = await app.request("/api/sessions", { headers: { host: "myhost.local:3000" } });
    expect(res.status).toBe(404);
  });

  it("passes requests without a Host header (in-process/HTTP-1.0 clients)", async () => {
    // app.request derives no Host header from a path-only URL.
    const res = await testApp().request("/api/sessions");
    expect(res.status).toBe(404);
  });

  it("rejects a malformed Host header instead of failing open", async () => {
    const res = await getWithHost("/api/sessions", "not a host");
    expect(res.status).toBe(403);
  });

  it("rejects Host headers carrying URL components (userinfo)", async () => {
    // new URL() would absorb "attacker.example" as userinfo and resolve the
    // hostname to the allowlisted localhost; the value is not a uri-host[:port].
    const res = await getWithHost("/api/sessions", "attacker.example@localhost");
    expect(res.status).toBe(403);
  });

  it("rejects Host headers carrying URL delimiters", async () => {
    // Parsing would absorb a trailing /?x into the pathname and pass the
    // allowlisted hostname, but none of these values is a bare authority.
    for (const host of ["localhost/", "localhost?x", "localhost#x"]) {
      const res = await getWithHost("/api/sessions", host);
      expect(res.status, host).toBe(403);
    }
  });

  it("does not register the guard on a non-loopback bind (deliberate exposure)", async () => {
    const app = testApp({ backendHost: "0.0.0.0" });
    const res = await app.request("/api/sessions", { headers: { host: "evil.example.com" } });
    expect(res.status).toBe(404);
  });
});
