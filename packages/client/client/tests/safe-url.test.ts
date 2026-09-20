/**
 * @file safe URL tests
 * @description Locks http(s)-only external links: valid URLs pass, XSS schemes map to null.
 */

import { describe, expect, it } from "vitest";
import { safeHttpUrl } from "../src/safe-http-url.js";

describe("safeHttpUrl", () => {
  it("passes https URLs through", () => {
    expect(safeHttpUrl("https://example.com/docs")).toBe("https://example.com/docs");
  });

  it("maps empty input to null", () => {
    expect(safeHttpUrl("")).toBeNull();
    expect(safeHttpUrl("   ")).toBeNull();
  });

  it("maps javascript: XSS schemes to null", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
  });

  it("maps non-http schemes to null", () => {
    expect(safeHttpUrl("ftp://example.com/file")).toBeNull();
  });
});
