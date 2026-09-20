/**
 * @file get server locale tests
 * @description Locks the SSR locale resolution: mirrored cookie wins, unknown/absent falls back to default.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOCALE_COOKIE_NAME } from "../src/i18n/constants.js";

const { headersMock } = vi.hoisted(() => ({ headersMock: vi.fn() }));

vi.mock("next/headers", () => ({
  headers: () => headersMock(),
}));

import { getServerLocale } from "../src/i18n/getServerLocale.js";

function withCookieHeader(cookie: string | null): void {
  headersMock.mockResolvedValue({ get: (name: string) => (name === "cookie" ? cookie : null) });
}

describe("getServerLocale", () => {
  beforeEach(() => {
    headersMock.mockReset();
  });

  it("resolves the mirrored cookie to the stored locale", async () => {
    withCookieHeader(`${LOCALE_COOKIE_NAME}=zh-CN`);
    await expect(getServerLocale()).resolves.toBe("zh-CN");
  });

  it("falls back to the default locale when no cookie is present", async () => {
    withCookieHeader(null);
    await expect(getServerLocale()).resolves.toBe("en");
  });

  it("falls back to the default locale on unknown cookie values", async () => {
    withCookieHeader(`${LOCALE_COOKIE_NAME}=fr`);
    await expect(getServerLocale()).resolves.toBe("en");
  });
});
