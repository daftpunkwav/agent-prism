"use client";

import { useMemo } from "react";
import { ArrowLeftRight, Lightbulb, Zap, AlertTriangle, Plus } from "lucide-react";
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
      const step = ev.step ?? 0;

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
  if (type === "thought") return <Lightbulb className="h-3 w-3" />;
  if (type === "action") return <Zap className="h-3 w-3" />;
  if (type === "observation") return <ArrowLeftRight className="h-3 w-3" />;
  if (type === "verify") return <Zap className="h-3 w-3 text-amber-500" />;
  if (type === "reflect") return <Lightbulb className="h-3 w-3 text-purple-500" />;
  if (type === "harness_edit") return <Plus className="h-3 w-3 text-green-500" />;
  return null;
}

export function TraceDiff({ columns }: TraceDiffProps) {
  const alignedRows = useMemo(() => alignTraces(columns), [columns]);
  const labels = columns.map((c) => c.label);
  const diffCount = alignedRows.filter((r) => r.differences.size > 0).length;

  if (columns.length < 2 || alignedRows.length === 0) {
    return null;
  }

  return (
    <section className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Trace 对比</h3>
          {diffCount > 0 && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30">
              {diffCount} 处差异
            </span>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground">
          按步骤对齐 · 高亮决策差异
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/30 border-b border-border">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground w-16">
                Step
              </th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground w-24">
                类型
              </th>
              {labels.map((label) => (
                <th
                  key={label}
                  className="px-3 py-2 text-left font-medium text-muted-foreground min-w-[180px]"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {alignedRows.map((row) => (
              <tr key={row.step} className="border-b border-border hover:bg-muted/20">
                <td className="px-3 py-2 font-mono text-muted-foreground align-top">
                  {row.step}
                </td>
                <td className="px-3 py-2 text-muted-foreground align-top">
                  <span className="inline-flex items-center gap-1 text-[10px]">
                    {getTypeIcon(row.type)}
                    {row.type}
                  </span>
                </td>
                {labels.map((label) => {
                  const text = row.contents[label];
                  const isDiff = row.differences.has(label);
                  return (
                    <td
                      key={label}
                      className={`px-3 py-2 align-top ${
                        isDiff ? "bg-amber-500/5 border-l-2 border-amber-500" : ""
                      }`}
                    >
                      {text ? (
                        <div className="space-y-1">
                          <p className="font-mono whitespace-pre-wrap break-words text-[11px]">
                            {text.length > 300 ? text.slice(0, 300) + "…" : text}
                          </p>
                          {isDiff && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono text-amber-700 dark:text-amber-400">
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