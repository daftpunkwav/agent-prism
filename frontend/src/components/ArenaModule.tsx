"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

type ArenaModuleProps = {
  /** 模块标题 */
  title: string;
  /** 收起时显示的摘要（标题下方完整宽度） */
  summary?: ReactNode;
  /** 是否展开 */
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** 标题行右侧操作（不触发展开） */
  actions?: ReactNode;
  /** 可选 eyebrow 标签 */
  eyebrow?: string;
  className?: string;
};

/**
 * Arena 可折叠模块：收起时标题一行、摘要独占下一行，避免挤在标题旁。
 */
export function ArenaModule({
  title,
  summary,
  open,
  onToggle,
  children,
  actions,
  eyebrow,
  className = "",
}: ArenaModuleProps) {
  return (
    <section className={"arena-module " + className} data-open={open}>
      <div className="arena-module-head">
        <div className="arena-module-head-row">
          <button
            type="button"
            className="arena-module-toggle"
            onClick={onToggle}
            aria-expanded={open}
          >
            <ChevronDown className="arena-module-chevron" aria-hidden />
            <span className="arena-module-titles">
              {eyebrow && <span className="eyebrow">{eyebrow}</span>}
              <span className="arena-module-title">{title}</span>
            </span>
          </button>
          {actions && (
            <div className="arena-module-actions" onClick={(e) => e.stopPropagation()}>
              {actions}
            </div>
          )}
        </div>
        {!open && summary != null && (
          <button
            type="button"
            className="arena-module-summary"
            onClick={onToggle}
            aria-label="展开实验维度配置"
          >
            {summary}
          </button>
        )}
      </div>
      <div
        className="arena-module-collapse"
        data-open={open}
        aria-hidden={!open}
        // 收起时禁止焦点落入折叠区内
        {...(!open ? { inert: true } : {})}
      >
        <div className="arena-module-collapse-inner">
          <div className="arena-module-body">{children}</div>
        </div>
      </div>
    </section>
  );
}
