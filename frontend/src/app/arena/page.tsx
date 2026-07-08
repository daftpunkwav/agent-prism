"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HelpCircle, Send, X } from "lucide-react";
import { TokenStatsPanel } from "@/components/TokenStatsPanel";
import { TraceView } from "@/components/TraceView";
import {
  ArenaEvent,
  ArenaMeta,
  DimensionId,
  TokenStats,
  fetchArenaMeta,
  streamArenaRun,
} from "@/lib/api";

type ColumnState = {
  label: string;
  events: ArenaEvent[];
  metrics?: ArenaEvent["metrics"];
  tokenStats?: TokenStats;
  error?: string;
};

const TASK_TEMPLATES = [
  "现在几点？",
  "计算 (128 + 64) * 2",
  "获取当前时间，并计算距离午夜的分钟数（先取时间再计算）",
];

function metricsToTokenStats(m: NonNullable<ArenaEvent["metrics"]>): TokenStats {
  return {
    input_tokens: m.input_tokens,
    output_tokens: m.output_tokens,
    total_tokens: m.total_tokens,
    context_window: m.context_window,
    max_input_tokens: m.max_input_tokens,
    max_output_tokens: m.max_output_tokens,
    context_usage_pct: m.context_usage_pct,
    input_usage_pct: m.input_usage_pct,
  };
}

export default function ArenaPage() {
  const [meta, setMeta] = useState<ArenaMeta | null>(null);
  const [dimension, setDimension] = useState<DimensionId>("framework");
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [columns, setColumns] = useState<Record<string, ColumnState>>({});
  const [showPromptBanner, setShowPromptBanner] = useState(true);
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
      const next = { ...col };

      if (event.type === "token_update" && event.token_stats) {
        next.tokenStats = event.token_stats;
      } else if (event.type !== "token_update") {
        next.events = [...col.events, event];
      }

      if (event.type === "complete" && event.metrics) {
        next.metrics = event.metrics;
        next.tokenStats = event.token_stats ?? metricsToTokenStats(event.metrics);
      }
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
    }
  };

  const columnList = useMemo(() => Object.values(columns), [columns]);

  const placeholderLabels =
    dimension === "framework"
      ? ["LangChain", "LangGraph"]
      : dimension === "prompt"
        ? ["Zero-shot", "Few-shot", "CoT Prompt", "Structured"]
        : Array.from({ length: columnCount }, (_, i) => `列 ${i + 1}`);

  return (
    <div className="space-y-5">
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
              <span className="ml-1.5 rounded border border-border px-1.5 py-0.5 text-[10px] font-mono">
                {d.columns}列
              </span>
            </button>
          ))}
        </div>
        {activeDim && (
          <p className="text-sm text-muted-foreground">{activeDim.subtitle}</p>
        )}
      </section>

      {dimension === "prompt" && showPromptBanner && (
        <div className="flex items-start gap-3 rounded border border-border bg-card p-4 text-sm">
          <HelpCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="flex-1">
            「CoT Prompt」只改 Prompt 文案；编排层「先推理后行动」见推理模式 → CoT+Tool（即将支持）。
          </p>
          <button type="button" className="btn-ghost !h-8 !px-2" onClick={() => setShowPromptBanner(false)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div
        className="grid gap-4"
        style={{
          gridTemplateColumns: `repeat(${Math.min(columnCount, 4)}, minmax(0, 1fr))`,
        }}
      >
        {columnList.length === 0 && !running
          ? placeholderLabels.slice(0, columnCount).map((name) => (
              <div key={name} className="column-card opacity-60">
                <div className="column-header">
                  <span className="font-semibold">{name}</span>
                </div>
                <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
                  输入问题后点击发送
                </div>
              </div>
            ))
          : columnList.map((col) => (
              <div key={col.label} className="column-card">
                <div className="column-header">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{col.label}</span>
                      {col.metrics && (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {col.metrics.success ? "OK" : "FAIL"} · {col.metrics.duration_ms}ms
                        </span>
                      )}
                    </div>
                    {col.tokenStats && <div className="mt-2"><TokenStatsPanel stats={col.tokenStats} compact /></div>}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto max-h-[440px]">
                  <TraceView events={col.events} running={running && !col.metrics} />
                </div>
                {col.tokenStats && <TokenStatsPanel stats={col.tokenStats} />}
                {col.metrics && (
                  <div className="border-t border-border px-3 py-2 font-mono text-[10px] text-muted-foreground flex gap-3">
                    <span>工具 {col.metrics.tool_calls}</span>
                    <span>步骤 {col.metrics.steps}</span>
                  </div>
                )}
              </div>
            ))}
      </div>

      <section className="rounded border border-border bg-card p-4 space-y-3">
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
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                runArena();
              }
            }}
            disabled={running}
          />
          <button
            type="button"
            className="btn-primary shrink-0"
            disabled={running || !question.trim()}
            onClick={runArena}
          >
            <Send className="h-4 w-4" />
            发送
          </button>
        </div>
      </section>
    </div>
  );
}
