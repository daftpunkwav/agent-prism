// @vitest-environment jsdom
/**
 * @file copy button tests
 * @description Locks the clipboard chip: copy, transient confirmation, and failure silence.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { CopyButton } from "../src/app/arena/CopyButton.js";

function setClipboard(impl: () => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn(impl) },
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderButton(label?: string) {
  return render(
    <I18nProvider initialLocale="en">
      <CopyButton text="payload" label={label} />
    </I18nProvider>,
  );
}

describe("CopyButton", () => {
  it("copies the payload and shows a transient confirmation", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { container } = renderButton("Copy raw");
    fireEvent.click(screen.getByRole("button", { name: "Copy raw" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("payload");
    expect(screen.getByRole("button", { name: getCatalog("en").builder.copied })).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(1300);
    });
    expect(screen.getByRole("button", { name: "Copy raw" })).toBeDefined();
    expect(container).toBeDefined();
  });

  it("keeps the label when the clipboard rejects", async () => {
    setClipboard(() => Promise.reject(new Error("denied")));
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: getCatalog("en").builder.copy }));
    await act(async () => {
      await Promise.resolve().catch(() => undefined);
    });
    expect(screen.getByRole("button", { name: getCatalog("en").builder.copy })).toBeDefined();
  });
});
