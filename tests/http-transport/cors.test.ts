/**
 * @file cors tests
 * @description Locks the CORS preflight policy: no wildcard allow-headers.
 */

import { describe, expect, it } from "vitest";
import { buildTestApp } from "./mock-deps.js";

describe("http-app CORS", () => {
  it("does not answer preflight with a wildcard allow-headers", async () => {
    const app = buildTestApp();
    const res = await app.request("/health", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Content-Type",
      },
    });
    const allowHeaders = res.headers.get("access-control-allow-headers");
    expect(allowHeaders).not.toBe("*");
    expect(allowHeaders).toContain("Content-Type");
  });
});
