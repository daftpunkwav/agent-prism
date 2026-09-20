/**
 * @file ThemeToggle
 * @description Light/dark theme toggle button for the shared UI package.
 *
 * Responsibilities:
 * - Flip the root "dark" class and persist the choice via the host's storage key
 * - Sync real state from the DOM before paint to avoid first-paint flicker
 *
 * Defaults to dark, matching the host layout's pre-rendered class. Labels come
 * in via props so the ui package stays locale-free. The control is a plain
 * click button: one icon shows the theme a click switches to.
 */

"use client";

import { useLayoutEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

/** Host-injected copy; the ui package never owns product wording. Defaults are short neutral English. */
export type ThemeToggleLabels = {
  /** Accessible name of the toggle button itself. */
  toggle: string;
  /** Title shown when the next click switches to light. */
  toLight: string;
  /** Title shown when the next click switches to dark. */
  toDark: string;
};

const DEFAULT_LABELS: ThemeToggleLabels = {
  toggle: "Toggle theme",
  toLight: "Switch to light theme",
  toDark: "Switch to dark theme",
};

/**
 * Theme toggle button.
 *
 * Defaults to ``"dark"`` — matching the host layout's pre-rendered class to avoid
 * first-paint flicker. ``useLayoutEffect`` syncs the real state from the DOM
 * before paint. The localStorage key is injected by the host (props.storageKey);
 * this component does not own the key name. All visible copy comes in via
 * props.labels so the ui package stays locale-free.
 *
 * The icon previews the target theme: Moon in light mode (click goes dark),
 * Sun in dark mode (click goes light).
 */
export function ThemeToggle({
  storageKey,
  labels = DEFAULT_LABELS,
}: {
  storageKey: string;
  labels?: ThemeToggleLabels;
}) {
  const [theme, setTheme] = useState<Theme>("dark");

  useLayoutEffect(() => {
    const current = document.documentElement.classList.contains("dark") ? "dark" : "light";
    setTheme(current);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    // Storage can throw (private mode, disabled storage); the class flip and the
    // icon state must stay in sync even when persistence fails.
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      /* persistence unavailable: keep the visual toggle, skip persisting */
    }
    setTheme(next);
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={labels.toggle}
      aria-pressed={theme === "dark"}
      title={theme === "dark" ? labels.toLight : labels.toDark}
    >
      {theme === "dark" ? (
        <Sun key="sun" className="theme-toggle-icon" aria-hidden />
      ) : (
        <Moon key="moon" className="theme-toggle-icon" aria-hidden />
      )}
    </button>
  );
}
