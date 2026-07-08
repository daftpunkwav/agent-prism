"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderOpen, Settings, Zap } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

const NAV = [
  { href: "/arena", label: "Arena", icon: Zap },
  { href: "/projects", label: "Projects", icon: FolderOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-[1680px] items-center justify-between px-4 md:px-8">
          <Link href="/arena" className="flex items-center gap-2.5 font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded border border-border text-xs font-mono">
              AP
            </span>
            <span>AgentPrism</span>
          </Link>
          <nav className="flex items-center gap-1">
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
                  {label}
                </Link>
              );
            })}
            <span className="mx-1 h-4 w-px bg-border" />
            <ThemeToggle />
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1680px] flex-1 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
