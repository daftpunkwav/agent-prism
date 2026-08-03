"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

type ArenaModuleProps = {
  /** 模块标题 */
  title: string;
  /** 收起时显示的摘要（可多行分组） */
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
 * Arena 可折叠模块：配置类默认收起，摘要仍可见；展开后显示完整内容。
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
          {!open && summary != null && (
            <span className="arena-module-summary">{summary}</span>
          )}
        </button>
        {actions && (
          <div className="arena-module-actions" onClick={(e) => e.stopPropagation()}>
            {actions}
          </div>
        )}
      </div>
      {open && <div className="arena-module-body">{children}</div>}
    </section>
  );
}
