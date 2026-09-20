/**
 * @file AppShell
 * @description The app's chrome: top navigation, toggles, and content shell.
 *
 * Responsibilities:
 * - Wrap every route with navigation and the content container
 * - Host the language and theme toggles
 *
 * Nav and toggle copy comes from the i18n catalogs (brand mark stays hardcoded);
 * the toggles stay presentation-only.
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Blocks, BookOpen, Compass, FolderOpen, History, Settings, Zap } from "lucide-react";
import { LanguageToggle, ThemeToggle } from "@agentprism/ui";
import { THEME_STORAGE_KEY } from "@/theme";
import { useLocale, useSetLocale, useT } from "@/i18n/useT";
import {
  DEFAULT_LOCALE,
  LOCALE_NATIVE_LABELS,
  SUPPORTED_LOCALES,
  isAppLocale,
} from "@/i18n/locale";
import { resolveMessage } from "@/i18n/resolveMessage";

/** Each language appears under its own name regardless of the active locale. */
const LANGUAGE_OPTIONS = SUPPORTED_LOCALES.map((locale) => ({
  value: locale,
  nativeLabel: LOCALE_NATIVE_LABELS[locale],
}));

/**
 * App chrome: nav, locale switcher, and page container.
 *
 * @param children Routed page content.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useT();
  const locale = useLocale();
  const setLocale = useSetLocale();
  const isArena = pathname.startsWith("/arena");
  // Workspace routes (arena, builder) fill the viewport: the app chrome plus the
  // route shell must never exceed one screen, so columns scroll internally.
  const isWorkspace = isArena || pathname.startsWith("/builder");
  const trackRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false });

  // NAV must live inside the component (or depend on t) — a module-level copy would freeze the language.
  const NAV = useMemo(
    () => [
      { href: "/arena", label: t("shell.nav.arena"), icon: Zap },
      { href: "/builder", label: t("shell.nav.builder"), icon: Blocks },
      { href: "/guide", label: t("shell.nav.guide"), icon: BookOpen },
      { href: "/learn", label: t("shell.nav.learn"), icon: Compass },
      { href: "/projects", label: t("shell.nav.projects"), icon: FolderOpen },
      { href: "/sessions", label: t("shell.nav.sessions"), icon: History },
      { href: "/settings", label: t("shell.nav.settings"), icon: Settings },
    ],
    [t],
  );

  // Lightweight client-side title sync on language switch; full SSR metadata comes from the cookie.
  useLayoutEffect(() => {
    document.title = resolveMessage(locale, "meta.title");
  }, [locale]);

  const handleLanguageChange = useCallback(
    (value: string) => {
      setLocale(isAppLocale(value) ? value : DEFAULT_LOCALE);
    },
    [setLocale],
  );

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const update = () => {
      const active = track.querySelector<HTMLElement>('.seg-tab[data-active="true"]');
      if (!active) {
        setIndicator((prev) => ({ ...prev, ready: false }));
        return;
      }
      setIndicator({
        left: active.offsetLeft,
        width: active.offsetWidth,
        ready: true,
      });
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(track);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [pathname]);

  return (
    <div
      className={
        isWorkspace ? "h-dvh flex flex-col overflow-hidden" : "min-h-screen flex flex-col"
      }
    >
      <header className="shell-header shrink-0">
        <div className="shell-header-inner">
          <Link href="/arena" className="brand-link group">
            <span className="brand-mark" aria-hidden>
              <span className="brand-mark-glyph">AP</span>
            </span>
            <span className="brand-wordmark">
              Agent<span className="brand-wordmark-accent">Prism</span>
            </span>
          </Link>

          <nav className="shell-nav" aria-label={t("shell.navAria")}>
            <div className="shell-nav-track" ref={trackRef}>
              <span
                className="shell-nav-indicator"
                data-ready={indicator.ready ? "true" : undefined}
                style={{
                  transform: `translateX(${indicator.left}px)`,
                  width: indicator.width,
                }}
                aria-hidden
              />
              {NAV.map(({ href, label, icon: Icon }) => {
                const active = pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className="seg-tab"
                    data-active={active}
                    aria-current={active ? "page" : undefined}
                    // Below sm the label span is display:none; keep the link named.
                    aria-label={label}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    <span className="hidden sm:inline">{label}</span>
                  </Link>
                );
              })}
            </div>
            <LanguageToggle
              locale={locale}
              options={LANGUAGE_OPTIONS}
              onChange={handleLanguageChange}
              ariaLabel={t("shell.language.aria")}
            />
            <ThemeToggle
              storageKey={THEME_STORAGE_KEY}
              labels={{
                toggle: t("shell.theme.toggle"),
                toLight: t("shell.theme.toLight"),
                toDark: t("shell.theme.toDark"),
              }}
            />
          </nav>
        </div>
        <div className="spectrum-line" aria-hidden />
      </header>

      <main
        className={
          isWorkspace
            ? "flex-1 min-h-0 overflow-hidden w-full max-w-[1680px] mx-auto page-enter"
            : "mx-auto w-full max-w-[1680px] flex-1 px-4 py-8 md:px-8 page-enter"
        }
      >
        {children}
      </main>
    </div>
  );
}
