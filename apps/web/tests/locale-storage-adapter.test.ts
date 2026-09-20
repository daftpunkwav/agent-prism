/**
 * @file locale storage adapter tests
 * @description Locks locale persistence: storage/cookie round-trip, server parsing, unavailable-storage survival.
 */

import { describe, expect, it } from "vitest";
import { storageCookieAdapter } from "../src/i18n/adapters/storageCookieAdapter.js";
import { LOCALE_COOKIE_NAME } from "../src/i18n/constants.js";

describe("storageCookieAdapter", () => {
  function installBrowserStubs() {
    const store = new Map<string, string>();
    let cookieJar = "";
    let lastCookieWrite = "";
    const localStorageStub = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    const documentStub = {
      get cookie() {
        return cookieJar;
      },
      set cookie(raw: string) {
        // Keep the visible name=value pair in the jar; remember the raw write for attribute assertions.
        lastCookieWrite = raw;
        const head = raw.split(";")[0] ?? "";
        cookieJar = cookieJar ? `${cookieJar}; ${head}` : head;
      },
    };
    Object.defineProperty(globalThis, "localStorage", { value: localStorageStub, configurable: true });
    Object.defineProperty(globalThis, "document", { value: documentStub, configurable: true });
    return { store, get lastCookieWrite() {
      return lastCookieWrite;
    }, get jar() {
      return cookieJar;
    } };
  }

  it("round-trips write → readClient and mirrors the cookie", () => {
    const stubs = installBrowserStubs();
    storageCookieAdapter.write("en");
    expect(storageCookieAdapter.readClient()).toBe("en");
    expect(stubs.jar).toContain(`${LOCALE_COOKIE_NAME}=en`);
    expect(stubs.lastCookieWrite).toContain("samesite=lax");
    expect(stubs.lastCookieWrite).toContain("path=/");
  });

  it("parses the cookie header server-side", () => {
    expect(
      storageCookieAdapter.readServer(`other=1; ${LOCALE_COOKIE_NAME}=en; x=y`),
    ).toBe("en");
    expect(storageCookieAdapter.readServer("other=1")).toBeNull();
    expect(storageCookieAdapter.readServer(undefined)).toBeNull();
  });

  it("survives unavailable storage", () => {
    Object.defineProperty(globalThis, "localStorage", { value: undefined, configurable: true });
    Object.defineProperty(globalThis, "document", { value: undefined, configurable: true });
    expect(() => storageCookieAdapter.write("en")).not.toThrow();
    expect(storageCookieAdapter.readClient()).toBeNull();
  });
});

