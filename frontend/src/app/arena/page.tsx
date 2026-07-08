"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, HelpCircle, Send, X, PanelRightClose, PanelRightOpen, Zap, BarChart3 } from "lucide-react";
import { TokenStatsPanel } from "@/components/TokenStatsPanel";
import { TraceView } from "@/components/TraceView";
import { ExperimentPanel } from "@/components/ExperimentPanel";
import { TraceDiff } from "@/components/TraceDiff";
import { WorkspacePanel } from "@/components/WorkspacePanel";
import {
  ArenaEvent,
  ArenaMeta,
  DimensionId,
  TokenStats,
  ProviderConfig,
  createProject,
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
  "获取当前时间，并计算距离午夜的分钟数",
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

/** 生成对比报告 HTML */
function ComparisonReport({ columns }: { columns: Record<string, ColumnState> }) {
  const cols = Object.values(columns).filter((c) => c.metrics);
  if (cols.length === 0) return null;

  // 按耗时排序
  const sorted = [...cols].sort((a, b) => (a.metrics!.duration_ms) - (b.metrics!.duration_ms));
  const fastest = sorted[0];
  const lowestToken = [...cols].sort((a, b) => a.metrics!.total_tokens - b.metrics!.total_tokens)[0];

  return (
    <div className="rounded-lg border border-border bg-card/50 p-4 space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-foreground/70" />
        <h3 className="text-sm font-semibold">对比报告</h3>
      </div>

      {/* 硬指标对比表 */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Agent</th>
              <th className="text-right py-2 px-3 font-medium text-muted-foreground">耗时</th>
              <th className="text-right py-2 px-3 font-medium text-muted-foreground">Token</th>
              <th className="text-right py-2 px-3 font-medium text-muted-foreground">工具调用</th>
              <th className="text-right py-2 px-3 font-medium text-muted-foreground">步骤</th>
              <th className="text-center py-2 pl-3 font-medium text-muted-foreground">状态</th>
            </tr>
          </thead>
          <tbody>
            {cols.map((col) => (
              <tr key={col.label} className="border-b border-border/50 last:border-0">
                <td className="py-2.5 pr-4 font-medium">{col.label}</td>
                <td className={`py-2.5 px-3 text-right font-mono ${col.metrics!.duration_ms === fastest.metrics!.duration_ms ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
                  {col.metrics!.duration_ms}ms
                  {col.metrics!.duration_ms === fastest.metrics!.duration_ms && " ⚡"}
                </td>
                <td className={`py-2.5 px-3 text-right font-mono ${col.metrics!.total_tokens === lowestToken.metrics!.total_tokens ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
                  {col.metrics!.total_tokens.toLocaleString()}
                  {col.metrics!.total_tokens === lowestToken.metrics!.total_tokens && " 💰"}
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-muted-foreground">
                  {col.metrics!.tool_calls}
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-muted-foreground">
                  {col.metrics!.steps}
                </td>
                <td className="py-2.5 pl-3 text-center">
                  {col.metrics!.success ? (
                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      成功
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-destructive">
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      失败
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 简要洞察 */}
      <div className="text-[11px] text-muted-foreground space-y-1">
        <p>
          ⚡ 最快: <span className="font-medium text-foreground">{fastest.label}</span>（{fastest.metrics!.duration_ms}ms）
        </p>
        <p>
          💰 最省 Token: <span className="font-medium text-foreground">{lowestToken.label}</span>（{lowestToken.metrics!.total_tokens.toLocaleString()} tokens）
        </p>
      </div>
    </div>
  );
}

export default function ArenaPage() {
  const [meta, setMeta] = useState<ArenaMeta | null>(null);
  const [dimension, setDimension] = useState<DimensionId>("framework");
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [columns, setColumns] = useState<Record<string, ColumnState>>({});
  const [showPromptBanner, setShowPromptBanner] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [providerCfg, setProviderCfg] = useState<ProviderConfig | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);

  // 确定当前活跃的 workspace（第一个完成或有内容的列）
  const activeWorkspace = useMemo(() => {
    const cols = Object.values(columns);
    if (cols.length === 0) return null;
    // 优先返回有 tokenStats 的列（已完成的）
    const completed = cols.find((c) => c.tokenStats);
    if (completed) return `${completed.label}_`;
    // 否则返回第一列的 workspace 名称前缀
    return `${cols[0].label}_`;
  }, [columns]);

  useEffect(() => {
    fetchArenaMeta()
      .then(setMeta)
      .finally(() => setMetaLoading(false));
  }, []);

  const activeDim = meta?.dimensions.find((d) => d.id === dimension);
  const columnCount = activeDim?.columns ?? 2;

  const handleEvent = useCallback((event: ArenaEvent) => {
    const label = event.pipeline;
    setColumns((prev) => {
      const col = prev[label] ?? { label, events: [] };
      const next = { ...col };

      if (event.type === "token_update" && event.token_stats) {
        next.tokenStats = event.token_stats as TokenStats;
      } else {
        next.events = [...col.events, event];
      }

      if (event.type === "complete" && event.metrics) {
        next.metrics = event.metrics;
        next.tokenStats = event.token_stats
          ? ({ ...event.token_stats } as TokenStats)
          : metricsToTokenStats(event.metrics);
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

  const cancelRun = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
  }, []);

  useEffect(() => {
    setColumns({});
  }, [dimension]);

  const columnList = useMemo(() => Object.values(columns), [columns]);

  const placeholderLabels =
    dimension === "framework"
      ? ["LangChain", "LangGraph"]
      : dimension === "prompt"
        ? ["Zero-shot", "Few-shot", "CoT Prompt", "Structured"]
        : Array.from({ length: columnCount }, (_, i) => `列 ${i + 1}`);

  const handleConfigChange = useCallback((cfg: {
    model: string;
    temperature: number;
    contextWindow: number;
    maxInputTokens: number;
    maxOutputTokens: number;
  }) => {
    setProviderCfg({
      provider_name: "",
      notes: "",
      website_url: "",
      api_key_set: false,
      api_key_preview: "",
      base_url: "",
      use_full_url: true,
      api_format: "anthropic_messages",
      auth_field: "ANTHROPIC_AUTH_TOKEN",
      model: cfg.model,
      temperature: cfg.temperature,
      context_window: cfg.contextWindow,
      max_input_tokens: cfg.maxInputTokens,
      max_output_tokens: cfg.maxOutputTokens,
    } as ProviderConfig);
  }, []);

  if (metaLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="space-y-4 text-center">
          <div className="w-12 h-12 mx-auto rounded-xl border-2 border-foreground/20 border-t-foreground animate-spin" />
          <p className="text-sm text-muted-foreground">加载 Arena 配置…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-4 h-[calc(100vh-8rem)]">
      {/* ===== 左侧栏：维度 + 实验参数 ===== */}
      <aside className="w-56 flex-shrink-0 space-y-4 overflow-y-auto hidden lg:block">
        <div className="space-y-2">
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground px-1">
            对比维度
          </p>
          <div className="space-y-1">
            {meta?.dimensions.map((d) => (
              <button
                key={d.id}
                type="button"
                className="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors"
                data-active={dimension === d.id}
                data-disabled={!d.mvp && dimension !== d.id}
                disabled={!d.mvp && dimension !== d.id}
                onClick={() => d.mvp && setDimension(d.id)}
                title={!d.mvp ? "后续版本开放" : undefined}
              >
                <span className={dimension === d.id ? "text-foreground font-medium" : "text-muted-foreground"}>
                  {d.label}
                </span>
                <span className="ml-1.5 text-[10px] font-mono text-muted-foreground">
                  {d.columns}列
                </span>
              </button>
            ))}
          </div>
        </div>

        {activeDim && (
          <div className="px-1">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {activeDim.subtitle}
            </p>
          </div>
        )}

        {dimension === "prompt" && showPromptBanner && (
          <div className="mx-1 flex items-start gap-2 rounded border border-border bg-card p-3 text-[11px]">
            <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <p className="flex-1 leading-relaxed">
              「CoT Prompt」只改 Prompt 文案。编排层变化见推理模式 → CoT+Tool。
            </p>
            <button type="button" className="btn-ghost !h-6 !px-1.5 shrink-0" onClick={() => setShowPromptBanner(false)}>
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        <ExperimentPanel dimension={dimension} columnCount={columnCount} />
      </aside>

      {/* ===== 中间：Arena 主区域 ===== */}
      <main className="flex-1 min-w-0 flex flex-col gap-4">
        {/* 移动端维度切换 */}
        <div className="lg:hidden flex flex-wrap gap-1.5">
          {meta?.dimensions.map((d) => (
            <button
              key={d.id}
              type="button"
              className="seg-tab text-xs"
              data-active={dimension === d.id}
              data-disabled={!d.mvp && dimension !== d.id}
              disabled={!d.mvp && dimension !== d.id}
              onClick={() => d.mvp && setDimension(d.id)}
            >
              {d.label}
              <span className="ml-1 text-[10px] font-mono opacity-60">{d.columns}</span>
            </button>
          ))}
          {activeDim && (
            <p className="w-full text-xs text-muted-foreground mt-1">{activeDim.subtitle}</p>
          )}
        </div>

        {/* 列输出 */}
        <div
          className="grid gap-3 flex-1 min-h-0"
          style={{
            gridTemplateColumns: `repeat(${Math.min(columnCount, 4)}, minmax(0, 1fr))`,
          }}
        >
          {columnList.length === 0 && !running
            ? placeholderLabels.slice(0, columnCount).map((name, i) => (
                <div key={name} className="column-card opacity-60">
                  <div className="column-header">
                    <span className="font-semibold text-sm">{name}</span>
                  </div>
                  <div className="flex flex-1 items-center justify-center p-6">
                    <div className="text-center space-y-3">
                      <div className="w-10 h-10 mx-auto rounded-full border-2 border-border flex items-center justify-center">
                        <Zap className="h-5 w-5 text-muted-foreground/50" />
                      </div>
                      <p className="text-xs text-muted-foreground">等待运行</p>
                    </div>
                  </div>
                </div>
              ))
            : columnList.map((col, i) => (
                <div
                  key={col.label}
                  className="column-card min-h-0"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <div className="column-header">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={"column-status-dot " + (running && !col.metrics ? "running" : col.metrics ? "done" : "") + " " + (col.error ? "error" : "")} />
                        <span className="font-semibold text-sm">{col.label}</span>
                        {col.metrics && (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {col.metrics.success ? "OK" : "FAIL"} · {col.metrics.duration_ms}ms
                          </span>
                        )}
                      </div>
                      {col.tokenStats && (
                        <div className="mt-1.5">
                          <TokenStatsPanel stats={col.tokenStats} compact />
                        </div>
                      )}
                    </div>
                    {running && !col.metrics && (
                      <button
                        type="button"
                        className="btn-ghost !h-7 !px-2 text-[10px] shrink-0"
                        onClick={cancelRun}
                      >
                        停止
                      </button>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto min-h-0">
                    <TraceView events={col.events} running={running && !col.metrics} />
                  </div>
                  {col.tokenStats && !col.metrics && (
                    <div className="px-3 pb-2">
                      <TokenStatsPanel stats={col.tokenStats} />
                    </div>
                  )}
                  {col.metrics && (
                    <div className="border-t border-border px-3 py-2 font-mono text-[10px] text-muted-foreground flex gap-3">
                      <span>工具 {col.metrics.tool_calls}</span>
                      <span>步骤 {col.metrics.steps}</span>
                    </div>
                  )}
                  {col.error && (
                    <div className="border-t border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                      {col.error}
                    </div>
                  )}
                </div>
              ))}
        </div>

        {/* 对比报告 */}
        {Object.values(columns).some((c) => c.metrics) && (
          <ComparisonReport columns={columns} />
        )}

        {/* Trace 对比 */}
        {!running && columnList.length >= 2 && columnList.every((c) => c.metrics) && (
          <TraceDiff columns={columnList} />
        )}

        {/* 输入区 */}
        <section className="rounded-lg border border-border bg-card/80 backdrop-blur-sm p-4 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {TASK_TEMPLATES.map((t) => (
              <button
                key={t}
                type="button"
                className="btn-ghost text-[11px] transition-all hover:scale-[1.02]"
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
            {running ? (
              <button
                type="button"
                className="btn-ghost shrink-0"
                onClick={cancelRun}
              >
                停止
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary shrink-0"
                disabled={!question.trim()}
                onClick={runArena}
              >
                <Send className="h-4 w-4" />
                发送
              </button>
            )}
          </div>
        </section>
      </main>

      {/* ===== 右侧栏：工作空间 ===== */}
      {showRightPanel && (
        <aside className="w-72 flex-shrink-0 rounded-lg border border-border bg-card overflow-hidden hidden xl:flex flex-col">
          <WorkspacePanel
            workspaceName={activeWorkspace}
            pollInterval={running ? 1500 : 5000}
          />
        </aside>
      )}

      {/* 切换右侧栏按钮 */}
      <button
        type="button"
        className="fixed right-4 top-20 z-40 btn-ghost !h-8 !w-8 !p-0 xl:hidden"
        onClick={() => setShowRightPanel(!showRightPanel)}
        title={showRightPanel ? "隐藏工作空间" : "显示工作空间"}
      >
        {showRightPanel ? (
          <PanelRightClose className="h-4 w-4" />
        ) : (
          <PanelRightOpen className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}
