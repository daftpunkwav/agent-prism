"use client";

import { useLayoutEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

/**
 * 主题切换按钮。
 *
 * 默认 ``"dark"`` — 与 layout.tsx 中预渲染的 class 保持一致，避免首屏
 * 渲染闪烁。``useLayoutEffect`` 在绘制前从 DOM 同步真实状态。
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useLayoutEffect(() => {
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
      className="theme-toggle"
      onClick={toggle}
      aria-label="切换主题"
      aria-pressed={theme === "dark"}
      title={theme === "dark" ? "切换到浅色" : "切换到深色"}
    >
      <span className="theme-toggle-track" data-theme={theme}>
        <Sun className="theme-toggle-icon theme-toggle-sun" aria-hidden />
        <Moon className="theme-toggle-icon theme-toggle-moon" aria-hidden />
        <span className="theme-toggle-thumb" />
      </span>
    </button>
  );
}
