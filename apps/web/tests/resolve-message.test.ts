/**
 * @file resolve message tests
 * @description Locks message resolution: interpolation, locale fallback, missing-key behavior.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveMessage } from "../src/i18n/resolveMessage.js";
import type { MessageKey } from "../src/i18n/catalogs/types.js";

describe("resolveMessage", () => {
  afterEach(() => {
    process.env.NODE_ENV = "test";
    vi.restoreAllMocks();
  });

  it("resolves from the current locale with interpolation", () => {
    expect(resolveMessage("zh-CN", "errors.route.digest", { digest: "abc123" })).toBe(
      "错误编号：abc123",
    );
    expect(resolveMessage("en", "errors.route.digest", { digest: "abc123" })).toBe(
      "Error digest: abc123",
    );
  });

  it("leaves unknown placeholders visible", () => {
    expect(resolveMessage("en", "errors.route.digest")).toBe("Error digest: {digest}");
  });

  it("falls back to the default-locale catalog when the current locale misses", () => {
    // "fr" is not registered yet — simulates a future locale before its catalog lands.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveMessage("fr" as never, "common.ok")).toBe("OK");
    expect(warn).not.toHaveBeenCalled();
  });

  it("marks missing keys in dev and degrades to the raw key in production", () => {
    const missing = "definitely.missing" as unknown as MessageKey;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveMessage("en", missing)).toBe("⟦definitely.missing⟧");
    expect(warn).toHaveBeenCalled();

    process.env.NODE_ENV = "production";
    expect(resolveMessage("en", missing)).toBe("definitely.missing");
  });
});

