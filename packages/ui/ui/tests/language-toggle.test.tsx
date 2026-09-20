// @vitest-environment jsdom
/**
 * @file LanguageToggle tests
 * @description Locks locale display and switching through the language toggle.
 *
 * Responsibilities:
 * - Pin the trigger showing the current locale's native label
 * - Pin option selection forwarding the locale value to the host
 * - Pin the component staying locale-free (options arrive via props)
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LanguageToggle } from "../src/LanguageToggle.js";

afterEach(() => cleanup());

beforeAll(() => {
  // jsdom ships no layout engine: stub the scroll helper the popup calls on open.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const OPTIONS = [
  { value: "en", nativeLabel: "English" },
  { value: "zh-CN", nativeLabel: "中文" },
] as const;

describe("LanguageToggle", () => {
  it("trigger shows the current locale label", () => {
    render(<LanguageToggle locale="en" options={[...OPTIONS]} onChange={() => {}} ariaLabel="Language" />);
    expect(screen.getByRole("button", { name: "Language" }).textContent).toContain("English");
  });

  it("selecting an option forwards its value", () => {
    const onChange = vi.fn();
    render(<LanguageToggle locale="en" options={[...OPTIONS]} onChange={onChange} ariaLabel="Language" />);
    fireEvent.click(screen.getByRole("button", { name: "Language" }));
    fireEvent.click(screen.getByRole("option", { name: "中文" }));
    expect(onChange).toHaveBeenCalledWith("zh-CN");
  });

  it("popup lists every host-provided option", () => {
    render(<LanguageToggle locale="zh-CN" options={[...OPTIONS]} onChange={() => {}} ariaLabel="Language" />);
    fireEvent.click(screen.getByRole("button", { name: "Language" }));
    expect(screen.getByRole("option", { name: "English" })).toBeDefined();
    expect(screen.getByRole("option", { name: "中文" })).toBeDefined();
  });
});
