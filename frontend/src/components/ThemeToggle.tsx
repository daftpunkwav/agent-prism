"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const current = document.documentElement.classList.contains("dark") ? "dark" : "light";
    setTheme(current);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    localStorage.setItem("agentprism-theme", next);
    setTheme(next);
  };

  return (
    <button
      type="button"
      className="btn-ghost justify-center"
      style={{ height: 34, width: 34, padding: 0 }}
      onClick={toggle}
      aria-label="切换主题"
      aria-pressed={theme === "dark"}
      title={theme === "dark" ? "切换到浅色" : "切换到深色"}
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
