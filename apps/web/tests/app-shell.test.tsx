// @vitest-environment jsdom
/**
 * @file app shell tests
 * @description Locks the app chrome: nav rendering, active route marking, workspace layout mode, and title sync.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getCatalog } from "@/i18n/catalogs";
import { AppShell } from "../src/components/AppShell.js";

let pathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// jsdom ships neither ResizeObserver nor offset geometry; the nav indicator only
// needs the observer contract, not real measurements.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

afterEach(cleanup);

function renderShell() {
  return render(
    <I18nProvider initialLocale="en">
      <AppShell>
        <p>page content</p>
      </AppShell>
    </I18nProvider>,
  );
}

describe("AppShell", () => {
  it("renders the brand, all nav entries, and the routed children", () => {
    pathname = "/settings";
    renderShell();
    expect(screen.getByText(/page content/)).toBeDefined();
    expect(screen.getByRole("link", { name: getCatalog("en").shell.nav.settings })).toBeDefined();
    for (const key of ["arena", "builder", "guide", "learn", "projects", "sessions"] as const) {
      expect(screen.getByRole("link", { name: getCatalog("en").shell.nav[key] })).toBeDefined();
    }
  });

  it("marks the current route and renders the workspace layout without scroll page chrome", () => {
    pathname = "/arena";
    const { container } = renderShell();
    const active = screen.getByRole("link", { name: getCatalog("en").shell.nav.arena });
    expect(active.getAttribute("aria-current")).toBe("page");
    expect(container.firstElementChild?.className).toContain("h-dvh");
  });

  it("uses the scrolling page layout outside workspace routes", () => {
    pathname = "/guide";
    const { container } = renderShell();
    expect(container.firstElementChild?.className).toContain("min-h-screen");
    const active = screen.getByRole("link", { name: getCatalog("en").shell.nav.guide });
    expect(active.getAttribute("aria-current")).toBe("page");
  });

  it("syncs the document title to the active locale", () => {
    pathname = "/";
    renderShell();
    expect(document.title).toBe(getCatalog("en").meta.title);
  });
});
