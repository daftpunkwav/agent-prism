"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HelpCircle, Send, X } from "lucide-react";
import {
  ArenaEvent,
  ArenaMeta,
  DimensionId,
  fetchArenaMeta,
  streamArenaRun,
} from "@/lib/api";

type ColumnState = {
  label: string;
  events: ArenaEvent[];
  metrics?: ArenaEvent["metrics"];
  error?: string;
};

const TASK_TEMPLATES = [
  "现在几点？",
  "计算 (128 + 64) * 2",
  "获取当前时间，并计算距离午夜的分钟数（先取时间再计算）",
];

export default function ArenaPage() {
  const [meta, setMeta] = useState<ArenaMeta | null>(null);
  const [dimension, setDimension] = useState<DimensionId>("framework");
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [columns, setColumns] = useState<Record<string, ColumnState>>({});
  const [showPromptBanner, setShowPromptBanner] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetchArenaMeta().then(setMeta).catch(console.error);
  }, []);

  const activeDim = meta?.dimensions.find((d) => d.id === dimension);
  const columnCount = activeDim?.columns ?? 2;

  const handleEvent = useCallback((event: ArenaEvent) => {
    const label = event.pipeline;
    setColumns((prev) => {
      const col = prev[label] ?? { label, events: [] };
      const next = { ...col, events: [...col.events, event] };
      if (event.type === "complete" && event.metrics) next.metrics = event.metrics;
      if (event.type === "error") next.error = event.message;
      return { ...prev, [label]: next };
    });
  }, []);

  const runArena = async () => {
    if (!question.trim() || running) return;
    setRunning(true);
    setColumns({});
    abortRef.current = new AbortController();

    try {
      await streamArenaRun(question, dimension, handleEvent, abortRef.current.signal);
    } catch (err) {
      console.error(err);
    } finally {
      setRunning(false);
      setShowConfirm(false);
    }
  };

  const columnList = useMemo(() => Object.values(columns), [columns]);

  const estimatedTokens = columnCount * 4200;

  return (
    <div className="space-y-5">
      {/* 维度 Tab */}
      <section className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {meta?.dimensions.map((d) => (
            <button
              key={d.id}
              type="button"
              className="seg-tab"
              data-active={dimension === d.id}
              data-disabled={!d.mvp}
              disabled={!d.mvp && dimension !== d.id}
              onClick={() => d.mvp && setDimension(d.id)}
              title={!d.mvp ? "后续版本开放" : undefined}
            >
              {d.label}
              <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-mono">
                {d.columns}列
              </span>
            </button>
          ))}
        </div>
        {activeDim && (
          <p className="text-sm text-muted-foreground">{activeDim.subtitle}</p>
        )}
      </section>

      {/* CoT 消歧 Banner */}
      {dimension === "prompt" && showPromptBanner && (
        <div className="flex items-start gap-3 rounded-[var(--radius)] border border-border bg-card p-4 text-sm">
          <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-chart-4" />
          <div className="flex-1 space-y-1">
            <p>
              提示词维度的「CoT Prompt」只改文案；若要看编排层「先推理后行动」，请切换到
              <button
                type="button"
                className="mx-1 text-primary underline"
                onClick={() => setDimension("reasoning")}
                disabled
                title="推理模式维度将在后续版本开放"
              >
                推理模式 → CoT+Tool
              </button>
              （即将支持）。
            </p>
          </div>
          <button type="button" className="btn-ghost !h-8 !px-2" onClick={() => setShowPromptBanner(false)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 列网格 */}
      <div
        className="grid gap-4"
        style={{
          gridTemplateColumns: `repeat(${Math.min(columnCount, 4)}, minmax(0, 1fr))`,
        }}
      >
        {columnList.length === 0 && !running
          ? Array.from({ length: columnCount }).map((_, i) => (
              <div key={i} className="column-card opacity-50">
                <div className="column-header">
                  <span className="font-mono text-xs text-muted-foreground">等待运行…</span>
                </div>
                <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
                  输入问题后发送
                </div>
              </div>
            ))
          : columnList.map((col) => (
              <div key={col.label} className="column-card">
                <div className="column-header">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full prism-accent" />
                    <span className="font-semibold">{col.label}</span>
                    {col.label === "CoT Prompt" && (
                      <span title="在 Prompt 中引导逐步思考，ReAct 编排不变">
                        <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                      </span>
                    )}
                  </div>
                  {col.metrics && (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {col.metrics.success ? "✅" : "❌"} {col.metrics.duration_ms}ms
                    </span>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto max-h-[480px] p-1">
                  {col.events.map((ev, idx) => {
                    if (ev.type === "complete") return null;
                    const cls =
                      ev.type === "thought"
                        ? `trace-thought${col.label === "CoT Prompt" ? " prompt-cot" : ""}`
                        : ev.type === "action"
                          ? "trace-action"
                          : ev.type === "observation"
                            ? "trace-observation"
                            : ev.type === "error"
                              ? "trace-error"
                              : "";
                    return (
                      <div key={idx} className={`trace-step ${cls}`}>
                        <div className="eyebrow mb-1">
                          {ev.type} · step {ev.step}
                        </div>
                        {ev.content && <p className="whitespace-pre-wrap">{ev.content}</p>}
                        {ev.tool && (
                          <p className="font-mono text-xs mt-1">
                            {ev.tool}({JSON.stringify(ev.args)})
                          </p>
                        )}
                        {ev.result && <p className="mt-1 text-muted-foreground">{ev.result}</p>}
                        {ev.message && <p className="text-destructive">{ev.message}</p>}
                      </div>
                    );
                  })}
                  {running && <p className="p-3 text-xs text-muted-foreground animate-pulse">运行中…</p>}
                </div>
                {col.metrics && (
                  <div className="border-t border-border px-4 py-2 font-mono text-[11px] text-muted-foreground flex gap-3">
                    <span>🔧 {col.metrics.tool_calls}</span>
                    <span>📊 {col.metrics.steps} steps</span>
                  </div>
                )}
              </div>
            ))}
      </div>

      {/* 输入区 */}
      <section className="rounded-[var(--radius)] border border-border bg-card p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {TASK_TEMPLATES.map((t) => (
            <button
              key={t}
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setQuestion(t)}
            >
              {t.length > 24 ? `${t.slice(0, 24)}…` : t}
            </button>
          ))}
        </div>
        <div className="flex gap-3">
          <input
            className="form-input flex-1"
            placeholder="输入你的问题…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && setShowConfirm(true)}
            disabled={running}
          />
          <button
            type="button"
            className="btn-primary shrink-0"
            disabled={running || !question.trim()}
            onClick={() => setShowConfirm(true)}
          >
            <Send className="h-4 w-4" />
            发送
          </button>
        </div>
      </section>

      {/* 跑前确认 */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-[var(--radius)] border border-border bg-card p-6 space-y-4">
            <h3 className="font-semibold">确认运行实验</h3>
            <p className="text-sm text-muted-foreground">
              维度：<strong className="text-foreground">{activeDim?.label}</strong> · {columnCount} 条管线并行
            </p>
            <p className="font-mono text-sm">
              预估消耗：~{(estimatedTokens / 1000).toFixed(1)}k tokens
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setShowConfirm(false)}>
                取消
              </button>
              <button type="button" className="btn-primary" onClick={runArena}>
                确认运行
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
