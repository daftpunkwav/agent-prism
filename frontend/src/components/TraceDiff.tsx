"use client";

import { useMemo, useState } from "react";
import { ArrowLeftRight, ChevronDown, ChevronUp, Lightbulb, Zap, AlertTriangle, Plus } from "lucide-react";
import { ArenaEvent } from "@/lib/api";

interface TraceDiffProps {
  columns: Array<{ label: string; events: ArenaEvent[] }>;
}

interface AlignedRow {
  step: number;
  type: string;
  contents: Record<string, string>;
  differences: Set<string>;
}

function alignTraces(columns: Array<{ label: string; events: ArenaEvent[] }>): AlignedRow[] {
  /** 按 step 对齐各列的事件。先合并 thought_delta 为完整文本。*/
  const rows: Map<number, AlignedRow> = new Map();
  const labels = columns.map((c) => c.label);

  for (const col of columns) {
    // 按 step 累积 thought_delta，再按顺序对齐
    const thoughtByStep = new Map<number, string>();
    for (const ev of col.events) {
      if (ev.type === "thought_delta") {
        const step = ev.step ?? 0;
        thoughtByStep.set(step, (thoughtByStep.get(step) || "") + (ev.content || ""));
      } else if (ev.type === "thought" && ev.content) {
        const step = ev.step ?? 0;
        // 完整 thought 优先覆盖（若无 delta）
        if (!thoughtByStep.has(step)) {
          thoughtByStep.set(step, ev.content);
        }
      }
    }

    const seenThoughtSteps = new Set<number>();
    for (const ev of col.events) {
      if (
        ev.type === "complete" ||
        ev.type === "token_update" ||
        ev.type === "error" ||
        ev.type === "thought_end"
      ) {
        continue;
      }
      // 判别联合：thinking 事件无 step 字段
      const step = "step" in ev ? (ev.step ?? 0) : 0;

      // thought_delta：每个 step 只写一次合并后的全文
      if (ev.type === "thought_delta") {
        if (seenThoughtSteps.has(step)) continue;
        seenThoughtSteps.add(step);
        const text = thoughtByStep.get(step) || "";
        if (!rows.has(step)) {
          rows.set(step, {
            step,
            type: "thought",
            contents: {},
            differences: new Set(),
          });
        }
        const row = rows.get(step)!;
        row.contents[col.label] = text;
        if (row.type !== "thought") row.differences.add("type");
        continue;
      }

      if (ev.type === "thought") {
        if (seenThoughtSteps.has(step)) continue;
        seenThoughtSteps.add(step);
      }

      const text = getEventText(ev);
      if (!rows.has(step)) {
        rows.set(step, {
          step,
          type: ev.type === "thought" ? "thought" : ev.type,
          contents: {},
          differences: new Set(),
        });
      }
      const row = rows.get(step)!;
      row.contents[col.label] = text;
      // 类型不一致视为差异
      if (row.type !== (ev.type === "thought" ? "thought" : ev.type)) {
        row.differences.add("type");
      }
    }
  }

  // 检测差异：相同 step 但内容不同
  const sortedRows = Array.from(rows.values()).sort((a, b) => a.step - b.step);
  for (const row of sortedRows) {
    const texts = labels.map((l) => row.contents[l] || "").filter(Boolean);
    if (texts.length >= 2) {
      const unique = new Set(texts);
      if (unique.size > 1) {
        for (const label of labels) {
          if (row.contents[label]) row.differences.add(label);
        }
      }
    }
  }

  return sortedRows;
}

function getEventText(ev: ArenaEvent): string {
  if (ev.type === "thought") return ev.content || "";
  if (ev.type === "action") {
    const args = ev.args ?? {};
    const argsStr = Object.keys(args).length ? JSON.stringify(args) : "";
    return `${ev.tool}(${argsStr})`;
  }
  if (ev.type === "observation") return ev.result || "";
  if (ev.type === "verify") return `[验证] ${"content" in ev ? ev.content || "" : ""}`;
  if (ev.type === "reflect") return `[反思] ${"content" in ev ? ev.content || "" : ""}`;
  if (ev.type === "harness_edit") return `[自进化] ${"content" in ev ? ev.content || "" : ""}`;
  return "";
}

function getTypeIcon(type: string) {
  if (type === "thought") return <Lightbulb className="h-3 w-3 text-spectrum-1" />;
  if (type === "action") return <Zap className="h-3 w-3 text-spectrum-2" />;
  if (type === "observation") return <ArrowLeftRight className="h-3 w-3 text-spectrum-3" />;
  if (type === "verify") return <Zap className="h-3 w-3 text-warning" />;
  if (type === "reflect") return <Lightbulb className="h-3 w-3 text-spectrum-3" />;
  if (type === "harness_edit") return <Plus className="h-3 w-3 text-success" />;
  return null;
}

export function TraceDiff({ columns }: TraceDiffProps) {
  const alignedRows = useMemo(() => alignTraces(columns), [columns]);
  const labels = columns.map((c) => c.label);
  const diffCount = alignedRows.filter((r) => r.differences.size > 0).length;
  // 展开的长文本集合：key = `${row.step}:${label}`
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // 文本截断阈值（PROGRESS §4.2.7：长 thought 需要展开交互）
  const TRUNCATE_AT = 300;

  if (columns.length < 2 || alignedRows.length === 0) {
    return null;
  }

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <section className="data-table-wrap fade-in">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4 text-primary" />
          <h3 className="page-title text-sm">Trace 对比</h3>
          {diffCount > 0 && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-warning/10 text-warning border border-warning/30">
              {diffCount} 处差异
            </span>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">
          按步骤对齐 · 高亮决策差异
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="!w-16">Step</th>
              <th className="!w-24">类型</th>
              {labels.map((label, idx) => (
                <th key={label} className="min-w-[180px]">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="w-1.5 h-1.5 rounded-sm"
                      style={{ background: `var(--spectrum-${(idx % 4) + 1})` }}
                    />
                    {label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {alignedRows.map((row) => (
              <tr key={row.step} className="hover:bg-muted/20">
                <td className="font-mono text-muted-foreground align-top">{row.step}</td>
                <td className="text-muted-foreground align-top">
                  <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider">
                    {getTypeIcon(row.type)}
                    {row.type}
                  </span>
                </td>
                {labels.map((label) => {
                  const text = row.contents[label] ?? "";
                  const isDiff = row.differences.has(label);
                  const cellKey = `${row.step}:${label}`;
                  const isExpanded = expanded.has(cellKey);
                  const needsTruncate = text.length > TRUNCATE_AT;
                  return (
                    <td
                      key={label}
                      className={
                        "align-top " +
                        (isDiff ? "bg-warning/5 border-l-2 border-warning" : "")
                      }
                    >
                      {text ? (
                        <div className="space-y-1">
                          <p className="font-mono whitespace-pre-wrap break-words text-[11px]">
                            {needsTruncate && !isExpanded
                              ? text.slice(0, TRUNCATE_AT) + "…"
                              : text}
                          </p>
                          {needsTruncate && (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground"
                              onClick={() => toggleExpand(cellKey)}
                              aria-expanded={isExpanded}
                            >
                              {isExpanded ? (
                                <>
                                  <ChevronUp className="h-2.5 w-2.5" />
                                  收起
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="h-2.5 w-2.5" />
                                  展开全文（{text.length} 字符）
                                </>
                              )}
                            </button>
                          )}
                          {isDiff && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono text-warning">
                              <AlertTriangle className="h-2.5 w-2.5" />
                              差异
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-[10px] italic">无</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}