"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, FolderOpen, Settings, Zap } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

const NAV = [
  { href: "/arena", label: "Arena", icon: Zap },
  { href: "/learn", label: "学习路径", icon: Compass },
  { href: "/projects", label: "项目", icon: FolderOpen },
  { href: "/settings", label: "设置", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isArena = pathname.startsWith("/arena");

  return (
    <div className={isArena ? "h-dvh flex flex-col overflow-hidden" : "min-h-screen flex flex-col"}>
      <header className="shell-header shrink-0 z-50">
        <div className="mx-auto flex h-14 max-w-[1680px] items-center justify-between px-4 md:px-6">
          <Link href="/arena" className="flex items-center gap-2.5 group min-w-0">
            <span className="brand-mark text-[10px] font-mono font-semibold tracking-tight text-muted-foreground group-hover:text-foreground transition-colors shrink-0">
              AP
            </span>
            <span className="brand-wordmark truncate">AgentPrism</span>
          </Link>
          <nav className="flex items-center gap-0.5 sm:gap-1 shrink-0">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className="seg-tab flex items-center gap-1.5"
                  data-active={active}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{label}</span>
                </Link>
              );
            })}
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            <ThemeToggle />
          </nav>
        </div>
        <div className="spectrum-line" aria-hidden />
      </header>
      <main
        className={
          isArena
            ? "flex-1 min-h-0 overflow-hidden w-full max-w-[1680px] mx-auto"
            : "mx-auto w-full max-w-[1680px] flex-1 px-4 py-8 md:px-8"
        }
      >
        {children}
      </main>
    </div>
  );
}
