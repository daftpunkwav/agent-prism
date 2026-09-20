// @vitest-environment jsdom
/**
 * @file ThemeToggle tests
 * @description Locks theme flipping, DOM sync, and persistence of the theme toggle.
 *
 * Responsibilities:
 * - Pin dark/light class toggling on the document root
 * - Pin persistence through the host-injected storage key
 * - Pin accessible name and title flipping with the state
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeToggle } from "../src/ThemeToggle.js";

const STORAGE_KEY = "test-theme";

beforeEach(() => {
  document.documentElement.classList.remove("dark");
  localStorage.clear();
});

afterEach(() => cleanup());

describe("ThemeToggle", () => {
  it("syncs the light state from a root without the dark class", () => {
    render(<ThemeToggle storageKey={STORAGE_KEY} />);
    const button = screen.getByRole("button", { name: "Toggle theme" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.getAttribute("title")).toBe("Switch to dark theme");
  });

  it("clicking switches to dark, persists, and flips the title", () => {
    render(<ThemeToggle storageKey={STORAGE_KEY} />);
    const button = screen.getByRole("button", { name: "Toggle theme" });
    fireEvent.click(button);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.getAttribute("title")).toBe("Switch to light theme");
  });

  it("clicking twice returns to light", () => {
    render(<ThemeToggle storageKey={STORAGE_KEY} />);
    const button = screen.getByRole("button", { name: "Toggle theme" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("light");
  });

  it("host labels override the defaults", () => {
    render(
      <ThemeToggle
        storageKey={STORAGE_KEY}
        labels={{ toggle: "Thema", toLight: "Hell", toDark: "Dunkel" }}
      />,
    );
    expect(screen.getByRole("button", { name: "Thema" }).getAttribute("title")).toBe("Dunkel");
  });
});
