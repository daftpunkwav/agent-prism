"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  GitCompare,
  HelpCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Send,
  Square,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import { ExperimentPanel } from "@/components/ExperimentPanel";
import { TokenStatsPanel } from "@/components/TokenStatsPanel";
import { TraceDiff } from "@/components/TraceDiff";
import { TraceView } from "@/components/TraceView";
import { WorkspacePanel } from "@/components/WorkspacePanel";
import {
  ArenaEvent,
  ArenaMeta,
  DimensionId,
  DimensionOption,
  PipelineMetrics,
  TokenStats,
  fetchArenaMeta,
  streamArenaRun,
} from "@/lib/api";

type ColumnState = {
  label: string;
  events: ArenaEvent[];
  metrics?: PipelineMetrics;
  tokenStats?: TokenStats;
  workspace?: string;
  error?: string;
};

type MainTab = "results" | "report" | "diff";

const TASK_TEMPLATES = [
  "现在几点？",
  "计算 (128 + 64) * 2",
  "获取当前时间，并计算距离午夜的分钟数",
];

function metricsToTokenStats(m: PipelineMetrics): TokenStats {
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

function DimensionChip({
  option,
  selected,
  onToggle,
}: {
  option: DimensionOption;
  selected: boolean;
  onToggle: (value: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(option.value)}
      data-selected={selected}
      className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors data-[selected=true]:bg-foreground data-[selected=true]:text-background data-[selected=true]:border-foreground data-[selected=false]:border-border data-[selected=false]:text-muted-foreground hover:text-foreground"
    >
      <span
        aria-hidden
        className={
          "inline-block h-1.5 w-1.5 rounded-sm " +
          (selected ? "bg-background" : "bg-muted-foreground/40")
        }
      />
      {option.label}
    </button>
  );
}

function ComparisonReport({ columns }: { columns: Record<string, ColumnState> }) {
  const cols = Object.values(columns).filter((c) => c.metrics);
  if (cols.length === 0) return null;

  const sorted = [...cols].sort((a, b) => (a.metrics!.duration_ms) - (b.metrics!.duration_ms));
  const fastest = sorted[0];
  const lowestToken = [...cols].sort((a, b) => a.metrics!.total_tokens - b.metrics!.total_tokens)[0];
  // 安全访问：filter 后 length >= 1，但 TS noUncheckedIndexedAccess 仍需断言
  if (!fastest?.metrics || !lowestToken?.metrics) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-foreground/70" />
        <h3 className="text-sm font-semibold">对比报告</h3>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left py-2 px-3 font-medium text-muted-foreground">Agent</th>
              <th className="text-right py-2 px-3 font-medium text-muted-foreground">耗时</th>
              <th className="text-right py-2 px-3 font-medium text-muted-foreground">Token</th>
              <th className="text-right py-2 px-3 font-medium text-muted-foreground">工具</th>
              <th className="text-right py-2 px-3 font-medium text-muted-foreground">步骤</th>
              <th className="text-center py-2 px-3 font-medium text-muted-foreground">状态</th>
            </tr>
          </thead>
          <tbody>
            {cols.map((col) => (
              <tr key={col.label} className="border-b border-border/50 last:border-0">
                <td className="py-2.5 px-3 font-medium">{col.label}</td>
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
                <td className="py-2.5 px-3 text-center">
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

function ColumnPlaceholder({ name }: { name: string }) {
  return (
    <div className="column-card opacity-60 h-full">
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
  );
}

function ColumnCard({
  col,
  running,
  showStop,
  onStop,
}: {
  col: ColumnState;
  running: boolean;
  showStop: boolean;
  onStop: () => void;
}) {
  return (
    <div className="column-card h-full min-h-0 flex flex-col">
      <div className="column-header shrink-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={
                "column-status-dot " +
                (running && !col.metrics ? "running" : col.metrics ? "done" : "") +
                " " +
                (col.error ? "error" : "")
              }
            />
            <span className="font-semibold text-sm truncate">{col.label}</span>
            {col.metrics && (
              <span className="font-mono text-[10px] text-muted-foreground shrink-0">
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
        {showStop && (
          <button
            type="button"
            className="btn-ghost !h-7 !px-2 text-[10px] shrink-0"
            onClick={onStop}
          >
            <Square className="h-3 w-3" />
            停止
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        <TraceView events={col.events} running={running && !col.metrics} />
      </div>
      {col.metrics && (
        <div className="border-t border-border px-3 py-2 font-mono text-[10px] text-muted-foreground flex gap-3 shrink-0">
          <span>工具 {col.metrics.tool_calls}</span>
          <span>步骤 {col.metrics.steps}</span>
        </div>
      )}
      {col.error && (
        <div className="border-t border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive shrink-0">
          {col.error}
        </div>
      )}
    </div>
  );
}

export function ArenaClient() {
  const [meta, setMeta] = useState<ArenaMeta | null>(null);
  const [dimension, setDimension] = useState<DimensionId>("framework");
  const [selections, setSelections] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [columns, setColumns] = useState<Record<string, ColumnState>>({});
  const [showPromptBanner, setShowPromptBanner] = useState(true);
  const [showLeftPanel, setShowLeftPanel] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [metaLoading, setMetaLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>("results");
  const abortRef = useRef<AbortController | null>(null);

  // 活跃 workspace 名称：直接从后端返回的 col.workspace 读取（后端在 complete
  // / token_update 事件中带 workspace 字段），无需前端猜测后缀。
  const activeWorkspace = useMemo(() => {
    const cols = Object.values(columns);
    if (cols.length === 0) return null;
    const completed = cols.find((c) => c.workspace);
    if (completed?.workspace) return completed.workspace;
    return cols[0]?.workspace ?? null;
  }, [columns]);

  useEffect(() => {
    const ac = new AbortController();
    fetchArenaMeta({ signal: ac.signal })
      .then(setMeta)
      .catch((err: Error) => {
        if (err.name !== "AbortError") {
          setError(`加载 Arena 配置失败: ${err.message}`);
        }
      })
      .finally(() => {
        if (!ac.signal.aborted) setMetaLoading(false);
      });
    return () => ac.abort();
  }, []);

  // 组件卸载时取消 in-flight Arena 运行，防止 setState on unmounted
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const activeDim = useMemo(
    () => meta?.dimensions.find((d) => d.id === dimension) ?? null,
    [meta, dimension],
  );

  const activeSelections = useMemo(
    () => (selections.length > 0 ? selections : activeDim?.options.map((o) => o.value) ?? []),
    [selections, activeDim],
  );

  const columnCount = activeSelections.length || 2;

  const placeholderLabels = useMemo(() => {
    if (activeDim) {
      return activeDim.options
        .filter((o) => activeSelections.includes(o.value))
        .map((o) => o.label);
    }
    return [];
  }, [activeDim, activeSelections]);

  const toggleSelection = useCallback(
    (value: string) => {
      setSelections((prev) => {
        const base = prev.length > 0 ? prev : activeDim?.options.map((o) => o.value) ?? [];
        const next = base.includes(value) ? base.filter((v) => v !== value) : [...base, value];
        return next;
      });
    },
    [activeDim],
  );

  const handleEvent = useCallback((event: ArenaEvent) => {
    const label = event.pipeline;
    setColumns((prev) => {
      const col = prev[label] ?? { label, events: [] };
      const next = { ...col };

      if (event.type === "token_update") {
        next.tokenStats = { ...event.token_stats };
        if (event.workspace) next.workspace = event.workspace;
      } else if (event.type === "complete") {
        if (event.metrics) {
          next.metrics = event.metrics;
          next.tokenStats = event.token_stats
            ? { ...event.token_stats }
            : metricsToTokenStats(event.metrics);
        }
        if (event.workspace) next.workspace = event.workspace;
        // complete 事件不追加到 events 列表（避免 TraceView 渲染空 segment）
      } else if (event.type === "error") {
        next.error = event.message || "运行错误";
        next.events = [...col.events, event];
      } else {
        next.events = [...col.events, event];
      }

      return { ...prev, [label]: next };
    });
  }, []);

  const cancelRun = useCallback(() => {
    const ac = abortRef.current;
    if (ac && !ac.signal.aborted) {
      ac.abort();
    }
    setRunning(false);
  }, []);

  const runArena = async () => {
    if (!question.trim() || running) return;
    if (activeSelections.length < 2) {
      setError("对比维度至少选择 2 个子项");
      return;
    }
    setError(null);
    setRunning(true);
    setMainTab("results");
    // 按当前 selections 预占位列名（占位卡保留）
    const placeholderCols: Record<string, ColumnState> = {};
    for (const opt of activeDim?.options ?? []) {
      if (activeSelections.includes(opt.value)) {
        placeholderCols[opt.label] = { label: opt.label, events: [] };
      }
    }
    setColumns(placeholderCols);
    abortRef.current = new AbortController();

    try {
      await streamArenaRun(question, dimension, handleEvent, abortRef.current.signal, activeSelections);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    setSelections([]);
    setColumns({});
    setError(null);
    setMainTab("results");
  }, [dimension]);

  const columnList = useMemo(() => Object.values(columns), [columns]);

  const hasMetrics = columnList.some((c) => c.metrics);
  const allCompleted = columnList.length >= 2 && columnList.every((c) => c.metrics);

  // 输出结果 Tab：列占位 + 实际运行卡
  const renderResultsTab = () => {
    if (activeDim) {
      const selectedOptions = activeDim.options.filter((o) => activeSelections.includes(o.value));
      if (selectedOptions.length === 0) {
        return (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            请选择至少 2 个对比项
          </div>
        );
      }
      return (
        <div
          className="grid gap-3 h-full min-h-0"
          style={{
            gridTemplateColumns: `repeat(${Math.min(columnCount, 4)}, minmax(0, 1fr))`,
          }}
        >
          {selectedOptions.map((opt) => {
            const col = columns[opt.label];
            return col ? (
              <ColumnCard
                key={opt.value}
                col={col}
                running={running}
                showStop={running && !col.metrics}
                onStop={cancelRun}
              />
            ) : (
              <ColumnPlaceholder key={opt.value} name={opt.label} />
            );
          })}
        </div>
      );
    }
    if (columnList.length === 0 && !running) {
      return (
        <div className="grid gap-3 h-full min-h-0 grid-cols-2">
          {placeholderLabels.slice(0, columnCount).map((name) => (
            <ColumnPlaceholder key={name} name={name} />
          ))}
        </div>
      );
    }
    return (
      <div
        className="grid gap-3 h-full min-h-0"
        style={{
          gridTemplateColumns: `repeat(${Math.min(columnList.length, 4)}, minmax(0, 1fr))`,
        }}
      >
        {columnList.map((col) => (
          <ColumnCard
            key={col.label}
            col={col}
            running={running}
            showStop={running && !col.metrics}
            onStop={cancelRun}
          />
        ))}
      </div>
    );
  };

  // 自动在全部完成后切到对比 Tab（仅一次）
  const reportVisitedRef = useRef(false);
  useEffect(() => {
    if (allCompleted && !reportVisitedRef.current) {
      setMainTab("report");
      reportVisitedRef.current = true;
    }
    if (!allCompleted) reportVisitedRef.current = false;
  }, [allCompleted]);

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
    <div className="flex flex-col h-[calc(100vh-7rem)] overflow-hidden">
      <div className="flex gap-3 flex-1 min-h-0">
        {/* ===== 左侧栏：维度 + 实验参数（独立滚动） ===== */}
        {showLeftPanel && (
          <aside className="w-64 flex-shrink-0 overflow-y-auto pr-1 space-y-4">
            <div className="space-y-2">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground px-1">
                对比维度
              </p>
              <div className="space-y-1">
                {meta?.dimensions.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors data-[active=true]:bg-muted data-[active=false]:hover:bg-muted/50"
                    data-active={dimension === d.id}
                    onClick={() => setDimension(d.id)}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={
                          dimension === d.id
                            ? "text-foreground font-semibold"
                            : "text-muted-foreground"
                        }
                      >
                        {d.label}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {d.max_select}项
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {activeDim && (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    参与对比
                  </p>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {activeSelections.length} / {activeDim.max_select}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {activeDim.options.map((opt) => (
                    <DimensionChip
                      key={opt.value}
                      option={opt}
                      selected={activeSelections.includes(opt.value)}
                      onToggle={toggleSelection}
                    />
                  ))}
                </div>
                {activeSelections.length < (activeDim.min_select ?? 2) && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 px-1">
                    至少选择 {activeDim.min_select ?? 2} 项
                  </p>
                )}
              </div>
            )}

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
                <button
                  type="button"
                  className="btn-ghost !h-6 !px-1.5 shrink-0"
                  onClick={() => setShowPromptBanner(false)}
                  aria-label="关闭提示"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            <ExperimentPanel dimension={dimension} columnCount={columnCount} />
          </aside>
        )}

        {/* ===== 中间：Tab 切换 + 内容（独立滚动） ===== */}
        <main className="flex-1 min-w-0 flex flex-col min-h-0">
          {/* Tab 栏 */}
          <div
            role="tablist"
            aria-label="Arena 视图切换"
            className="flex items-center gap-1 border-b border-border mb-3 shrink-0"
          >
            <MainTabButton
              active={mainTab === "results"}
              onClick={() => setMainTab("results")}
              icon={<Terminal className="h-3.5 w-3.5" />}
              label="输出结果"
              badge={running ? "运行中" : columnList.length > 0 ? columnList.length : null}
            />
            <MainTabButton
              active={mainTab === "report"}
              onClick={() => setMainTab("report")}
              icon={<BarChart3 className="h-3.5 w-3.5" />}
              label="对比报告"
              disabled={!hasMetrics}
              disabledReason="至少有一条 Pipeline 完成后才能查看报告"
              badge={hasMetrics ? columnList.filter((c) => c.metrics).length : null}
            />
            <MainTabButton
              active={mainTab === "diff"}
              onClick={() => setMainTab("diff")}
              icon={<GitCompare className="h-3.5 w-3.5" />}
              label="Trace 对比"
              disabled={!allCompleted}
              disabledReason="所有 Pipeline 完成后才能对比"
            />
          </div>

          {/* Tab 内容区（独立滚动） */}
          <div className="flex-1 min-h-0 overflow-y-auto pr-1">
            {mainTab === "results" && renderResultsTab()}
            {mainTab === "report" && hasMetrics && <ComparisonReport columns={columns} />}
            {mainTab === "report" && !hasMetrics && (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                暂无完成的对比数据
              </div>
            )}
            {mainTab === "diff" && allCompleted && <TraceDiff columns={columnList} />}
            {mainTab === "diff" && !allCompleted && (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                等待所有 Agent 完成后显示
              </div>
            )}
          </div>
        </main>

        {/* ===== 右侧栏：工作空间（独立滚动） ===== */}
        {showRightPanel && (
          <aside className="w-72 flex-shrink-0 rounded-lg border border-border bg-card overflow-hidden hidden xl:flex flex-col">
            <WorkspacePanel
              workspaceName={activeWorkspace}
              pollInterval={running ? 1500 : 5000}
            />
          </aside>
        )}
      </div>

      {/* ===== 底部：输入区（固定不滚动） ===== */}
      <section className="shrink-0 mt-3 rounded-lg border border-border bg-card/95 backdrop-blur-sm p-3 space-y-2">
        {error && (
          <p className="text-xs text-destructive border border-destructive/30 bg-destructive/5 rounded px-3 py-1.5">
            {error}
          </p>
        )}
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
              aria-label="停止 Arena 运行"
            >
              <Square className="h-4 w-4" />
              停止
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary shrink-0"
              disabled={!question.trim() || activeSelections.length < 2}
              title={
                !question.trim()
                  ? "请输入问题"
                  : activeSelections.length < 2
                    ? "至少选择 2 个对比项"
                    : undefined
              }
              onClick={runArena}
            >
              <Send className="h-4 w-4" />
              发送
            </button>
          )}
        </div>
      </section>

      {/* 折叠按钮：左侧栏 */}
      <div className="fixed right-4 top-20 z-40 flex flex-col gap-1">
        <button
          type="button"
          className="btn-ghost !h-8 !w-8 !p-0"
          onClick={() => setShowLeftPanel(!showLeftPanel)}
          aria-label={showLeftPanel ? "隐藏左侧维度栏" : "显示左侧维度栏"}
          aria-expanded={showLeftPanel}
          title={showLeftPanel ? "隐藏左侧维度栏" : "显示左侧维度栏"}
        >
          {showLeftPanel ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </button>
        <button
          type="button"
          className="btn-ghost !h-8 !w-8 !p-0"
          onClick={() => setShowRightPanel(!showRightPanel)}
          aria-label={showRightPanel ? "隐藏工作空间" : "显示工作空间"}
          aria-expanded={showRightPanel}
          title={showRightPanel ? "隐藏工作空间" : "显示工作空间"}
        >
          {showRightPanel ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function MainTabButton({
  active,
  onClick,
  icon,
  label,
  disabled,
  disabledReason,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
  badge?: number | string | null;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-disabled={disabled}
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      className="relative inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors data-[active=true]:text-foreground data-[active=false]:text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-muted-foreground"
      data-active={active}
    >
      {icon}
      {label}
      {badge != null && (
        <span className="ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-4 px-1 rounded-full bg-muted text-[10px] font-mono">
          {badge}
        </span>
      )}
      {active && (
        <span className="absolute left-0 right-0 -bottom-px h-px bg-foreground" />
      )}
    </button>
  );
}