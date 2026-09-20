// @vitest-environment jsdom
/**
 * @file global-error tests
 * @description Locks the root error boundary: self-bootstrapped markup, digest line, retry, stored locale.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getCatalog } from "@/i18n/catalogs";
import { LOCALE_STORAGE_KEY } from "@/i18n/constants";
import GlobalError from "../src/app/global-error.js";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

function renderError(error: Error & { digest?: string }, reset: () => void) {
  return render(<GlobalError error={error} reset={reset} />);
}

describe("global error boundary", () => {
  it("renders the failure page and calls reset on retry", () => {
    const reset = vi.fn();
    renderError(new Error("boom"), reset);
    expect(screen.getByText(getCatalog("en").errors.global.title)).toBeDefined();
    expect(screen.getByText(getCatalog("en").errors.global.body)).toBeDefined();
    expect(screen.queryByText(/digest/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: getCatalog("en").errors.global.retry }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("shows the digest line when the error carries one", () => {
    renderError(Object.assign(new Error("boom"), { digest: "abc123" }), () => {});
    expect(screen.getByText(getCatalog("en").errors.global.digest.replace("{digest}", "abc123"))).toBeDefined();
  });

  it("switches to the stored locale after mount", async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    renderError(new Error("boom"), () => {});
    expect(await screen.findByText(getCatalog("zh-CN").errors.global.title)).toBeDefined();
  });
});
