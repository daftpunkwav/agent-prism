"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Compass, FolderOpen, Settings, Zap } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

const NAV = [
  { href: "/arena", label: "Arena", icon: Zap },
  { href: "/guide", label: "维度说明", icon: BookOpen },
  { href: "/learn", label: "学习路径", icon: Compass },
  { href: "/projects", label: "项目", icon: FolderOpen },
  { href: "/settings", label: "设置", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isArena = pathname.startsWith("/arena");

  return (
    <div
      className={
        isArena ? "h-dvh flex flex-col overflow-hidden" : "min-h-screen flex flex-col"
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

          <nav className="shell-nav" aria-label="主导航">
            <div className="shell-nav-track">
              {NAV.map(({ href, label, icon: Icon }) => {
                const active = pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className="seg-tab"
                    data-active={active}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    <span className="hidden sm:inline">{label}</span>
                  </Link>
                );
              })}
            </div>
            <span className="shell-nav-divider" aria-hidden />
            <ThemeToggle />
          </nav>
        </div>
        <div className="spectrum-line" aria-hidden />
      </header>

      <main
        className={
          isArena
            ? "flex-1 min-h-0 overflow-hidden w-full max-w-[1680px] mx-auto page-enter"
            : "mx-auto w-full max-w-[1680px] flex-1 px-4 py-8 md:px-8 page-enter"
        }
      >
        {children}
      </main>
    </div>
  );
}
