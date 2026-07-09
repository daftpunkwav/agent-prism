"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

/**
 * 主题切换按钮。
 *
 * 默认 ``"dark"`` — 与 layout.tsx 中预渲染的 class 保持一致，避免首屏
 * 渲染闪烁（icon 从 null → Sun/Moon 的切换）。``useLayoutEffect`` 在浏览器
 * 绘制前同步从 DOM 读真实状态。
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

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
