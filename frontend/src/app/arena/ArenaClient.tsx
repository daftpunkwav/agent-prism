"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Check,
  FolderPlus,
  GitCompare,
  HelpCircle,
  Loader2,
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
  BaselineOverrides,
  DimensionId,
  DimensionOption,
  TokenStats,
  createProject,
  fetchArenaMeta,
  isAbortError,
  streamArenaRun,
} from "@/lib/api";

/** 对比维度 → PipelineConfig 字段（与后端 DIMENSION_FIELD 对齐） */
const DIMENSION_FIELD: Record<DimensionId, keyof BaselineOverrides> = {
  framework: "framework",
  prompt: "prompt_profile",
  reasoning: "reasoning",
  context: "context",
  harness: "harness",
};

type ColumnState = {
  label: string;
  events: ArenaEvent[];
  metrics?: ArenaEvent["metrics"];
  tokenStats?: TokenStats;
  error?: string;
  /** 后端实际工作空间名（来自 complete/token_update 事件） */
  workspace?: string;
};

type MainTab = "results" | "report" | "diff";

const TASK_TEMPLATES: Array<{ id: string; label: string; question: string }> = [
  { id: "time", label: "时间", question: "现在几点？" },
  { id: "calc", label: "计算", question: "计算 (128 + 64) * 2 / 8 + 15" },
  {
    id: "multi-time",
    label: "多步·时间",
    question: "获取当前时间，并计算距离午夜的分钟数",
  },
  {
    id: "multi-factorial",
    label: "多步·阶乘",
    question: "先用代码计算 17 的阶乘，再把结果写入 result.txt",
  },
  {
    id: "files",
    label: "文件读写",
    question: "创建 notes.md，写入三条今日待办，再读取并列出工作空间文件",
  },
  {
    id: "code-file",
    label: "代码+文件",
    question:
      "写一个 hello.py（打印 Hello AgentPrism），用 run_code 执行它，把输出追加到 log.txt",
  },
  {
    id: "primes",
    label: "素数统计",
    question: "用代码找出 1 到 100 中所有素数，并统计个数",
  },
  {
    id: "fibonacci",
    label: "斐波那契",
    question: "用代码生成斐波那契数列前 20 项，写入 fib.txt",
  },
  {
    id: "summarize",
    label: "文本摘要",
    question:
      "将下面文字摘要到 80 字以内：Agent 对比实验需要在相同任务下并行观察框架、提示词、推理模式与上下文策略的差异，才能量化延迟、Token 与工具调用次数。",
  },
  {
    id: "pipeline",
    label: "综合编排",
    question:
      "获取当前时间 → 计算本小时还剩多少分钟 → 把结论写入 report.md → 再摘要该文件内容",
  },
  {
    id: "plan",
    label: "实验规划",
    question:
      "规划一个三步实验：对比 LangChain 与 LangGraph 在工具调用上的差异；每步写清目标、工具与成功标准",
  },
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

function LaneTile({
  option,
  selected,
  onToggle,
  lane,
}: {
  option: DimensionOption;
  selected: boolean;
  onToggle: (value: string) => void;
  lane: number;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(option.value)}
      data-selected={selected}
      data-lane={lane % 4}
      className="lane-tile"
      aria-pressed={selected}
    >
      <span className="lane-tile-check" aria-hidden>
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
      <span className="truncate">{option.label}</span>
    </button>
  );
}

function ComparisonReport({ columns }: { columns: Record<string, ColumnState> }) {
  const cols = Object.values(columns).filter((c) => c.metrics);
  if (cols.length === 0) return null;

  const sorted = [...cols].sort((a, b) => a.metrics!.duration_ms - b.metrics!.duration_ms);
  const fastest = sorted[0];
  const lowestToken = [...cols].sort(
    (a, b) => a.metrics!.total_tokens - b.metrics!.total_tokens,
  )[0];
  if (!fastest?.metrics || !lowestToken?.metrics) return null;

  return (
    <div className="space-y-4 fade-in">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-primary" />
        <h3 className="page-title text-base">对比报告</h3>
      </div>

      <div className="data-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th className="!text-right">耗时</th>
              <th className="!text-right">Token</th>
              <th className="!text-right">工具</th>
              <th className="!text-right">步骤</th>
              <th className="!text-center">状态</th>
            </tr>
          </thead>
          <tbody>
            {cols.map((col) => {
              const isFastest = col.metrics!.duration_ms === fastest.metrics!.duration_ms;
              const isLowest = col.metrics!.total_tokens === lowestToken.metrics!.total_tokens;
              return (
                <tr key={col.label}>
                  <td className="font-medium">{col.label}</td>
                  <td
                    className={
                      "text-right font-mono " +
                      (isFastest ? "metric-best" : "text-muted-foreground")
                    }
                  >
                    {col.metrics!.duration_ms}ms
                    {isFastest && <span className="metric-best-mark">最快</span>}
                  </td>
                  <td
                    className={
                      "text-right font-mono " +
                      (isLowest ? "metric-best" : "text-muted-foreground")
                    }
                  >
                    {col.metrics!.total_tokens.toLocaleString()}
                    {isLowest && <span className="metric-best-mark">最省</span>}
                  </td>
                  <td className="text-right font-mono text-muted-foreground">
                    {col.metrics!.tool_calls}
                  </td>
                  <td className="text-right font-mono text-muted-foreground">
                    {col.metrics!.steps}
                  </td>
                  <td className="text-center">
                    {col.metrics!.success ? (
                      <span className="inline-flex items-center gap-1.5 text-success">
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        成功
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-destructive">
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        失败
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-muted-foreground">
        <p>
          最快：
          <span className="font-medium text-foreground"> {fastest.label}</span>
          <span className="font-mono"> · {fastest.metrics!.duration_ms}ms</span>
        </p>
        <p>
          最省 Token：
          <span className="font-medium text-foreground"> {lowestToken.label}</span>
          <span className="font-mono">
            {" "}
            · {lowestToken.metrics!.total_tokens.toLocaleString()}
          </span>
        </p>
      </div>
    </div>
  );
}

function ColumnPlaceholder({ name, lane }: { name: string; lane: number }) {
  return (
    <div className="column-card opacity-70 h-full" data-lane={lane % 4}>
      <div className="column-header">
        <span className="font-semibold text-sm">{name}</span>
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="empty-state !py-6">
          <div className="empty-state-icon">
            <Zap className="h-5 w-5" />
          </div>
          <p className="text-xs">等待运行</p>
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
  lane,
}: {
  col: ColumnState;
  running: boolean;
  showStop: boolean;
  onStop: () => void;
  lane: number;
}) {
  return (
    <div className="column-card h-full min-h-0 flex flex-col" data-lane={lane % 4}>
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
        <TraceView events={col.events} running={running && !col.metrics} colorIndex={lane} />
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
  const [baseline, setBaseline] = useState<BaselineOverrides>({});
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [columns, setColumns] = useState<Record<string, ColumnState>>({});
  const [showPromptBanner, setShowPromptBanner] = useState(true);
  const [showLeftPanel, setShowLeftPanel] = useState(false);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [metaLoading, setMetaLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>("results");
  const abortRef = useRef<AbortController | null>(null);
  const [projectName, setProjectName] = useState("");
  const [savingProject, setSavingProject] = useState(false);
  const [saveProjectMsg, setSaveProjectMsg] = useState<string | null>(null);

  const activeWorkspace = useMemo(() => {
    const cols = Object.values(columns);
    if (cols.length === 0) return null;
    const withWs = cols.find((c) => c.workspace);
    if (withWs?.workspace) return withWs.workspace;
    for (const col of cols) {
      for (let i = col.events.length - 1; i >= 0; i--) {
        const ws = col.events[i]?.workspace;
        if (ws) return ws;
      }
    }
    return null;
  }, [columns]);

  useEffect(() => {
    const ac = new AbortController();
    fetchArenaMeta({ signal: ac.signal })
      .then((m) => {
        setMeta(m);
        if (m.baseline_defaults) {
          const d = m.baseline_defaults;
          setBaseline({
            framework: d.framework,
            reasoning: d.reasoning,
            context: d.context,
            harness: d.harness,
            prompt_profile: d.prompt_profile,
          });
        }
      })
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

  const baselinePayload = useMemo(() => {
    const locked = DIMENSION_FIELD[dimension];
    const out: BaselineOverrides = {};
    (Object.keys(baseline) as Array<keyof BaselineOverrides>).forEach((key) => {
      const val = baseline[key];
      if (key !== locked && typeof val === "string" && val) {
        out[key] = val;
      }
    });
    return out;
  }, [baseline, dimension]);

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

      if (event.workspace) {
        next.workspace = event.workspace;
      }

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
    const placeholderCols: Record<string, ColumnState> = {};
    for (const opt of activeDim?.options ?? []) {
      if (activeSelections.includes(opt.value)) {
        placeholderCols[opt.label] = { label: opt.label, events: [] };
      }
    }
    setColumns(placeholderCols);
    abortRef.current = new AbortController();

    const signal = abortRef.current.signal;
    try {
      await streamArenaRun(
        question,
        dimension,
        handleEvent,
        signal,
        activeSelections,
        baselinePayload,
      );
    } catch (err) {
      if (isAbortError(err) || signal.aborted) return;
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
    setProjectName("");
    setSaveProjectMsg(null);
  }, [dimension]);

  const columnList = useMemo(() => Object.values(columns), [columns]);

  const hasMetrics = columnList.some((c) => c.metrics);
  const allCompleted = columnList.length >= 2 && columnList.every((c) => c.metrics);

  const saveAsProject = useCallback(async () => {
    if (!allCompleted || savingProject) return;
    const workspaceNames = columnList
      .map((c) => c.workspace)
      .filter((w): w is string => Boolean(w));
    if (workspaceNames.length === 0) {
      setSaveProjectMsg("没有可用的工作空间名称，无法保存");
      return;
    }
    const name =
      projectName.trim() ||
      `Arena ${dimension} · ${new Date().toLocaleString("zh-CN", { hour12: false })}`;
    setSavingProject(true);
    setSaveProjectMsg(null);
    try {
      const { project } = await createProject({
        name,
        question: question.trim(),
        dimension,
        pipeline_labels: columnList.map((c) => c.label),
        workspace_names: workspaceNames,
      });
      setSaveProjectMsg(`已保存项目「${project.name}」`);
      setProjectName("");
    } catch (err) {
      setSaveProjectMsg(err instanceof Error ? err.message : "保存项目失败");
    } finally {
      setSavingProject(false);
    }
  }, [allCompleted, savingProject, columnList, projectName, dimension, question]);

  const renderResultsTab = () => {
    if (activeDim) {
      const selectedOptions = activeDim.options.filter((o) =>
        activeSelections.includes(o.value),
      );
      if (selectedOptions.length === 0) {
        return (
          <div className="empty-state h-full">
            <div className="empty-state-icon">
              <Zap className="h-5 w-5" />
            </div>
            <p className="text-sm">请选择至少 2 个对比项</p>
          </div>
        );
      }
      return (
        <div className="arena-columns" data-count={Math.min(selectedOptions.length, 4)}>
          {selectedOptions.map((opt, idx) => {
            const col = columns[opt.label];
            return col ? (
              <ColumnCard
                key={opt.value}
                col={col}
                running={running}
                showStop={running && !col.metrics}
                onStop={cancelRun}
                lane={idx}
              />
            ) : (
              <ColumnPlaceholder key={opt.value} name={opt.label} lane={idx} />
            );
          })}
        </div>
      );
    }
    if (columnList.length === 0 && !running) {
      return (
        <div className="arena-columns" data-count={Math.min(columnCount, 4)}>
          {placeholderLabels.slice(0, columnCount).map((name, idx) => (
            <ColumnPlaceholder key={name} name={name} lane={idx} />
          ))}
        </div>
      );
    }
    return (
      <div className="arena-columns" data-count={Math.min(columnList.length, 4)}>
        {columnList.map((col, idx) => (
          <ColumnCard
            key={col.label}
            col={col}
            running={running}
            showStop={running && !col.metrics}
            onStop={cancelRun}
            lane={idx}
          />
        ))}
      </div>
    );
  };

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
      <div className="arena-shell items-center justify-center">
        <div className="space-y-4 text-center fade-in">
          <div className="loading-prism mx-auto" aria-hidden />
          <p className="text-sm text-muted-foreground">加载 Arena 配置…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="arena-shell">
      <div className="arena-chrome">
        <section className="arena-setup">
          <div className="arena-setup-head">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="eyebrow shrink-0">对比维度</p>
                {activeDim && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {activeDim.label}
                  </span>
                )}
              </div>
              <div className="dim-rail" role="tablist" aria-label="对比维度">
                {meta?.dimensions.map((d, i) => (
                  <button
                    key={d.id}
                    type="button"
                    role="tab"
                    aria-selected={dimension === d.id}
                    className="dim-rail-item"
                    data-active={dimension === d.id}
                    onClick={() => setDimension(d.id)}
                  >
                    <span className="dim-rail-index">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="dim-rail-label">{d.label}</span>
                  </button>
                ))}
              </div>
              {activeDim?.subtitle && (
                <p className="arena-subtitle">{activeDim.subtitle}</p>
              )}
            </div>

            <div className="arena-setup-tools">
              <button
                type="button"
                className="btn-ghost !h-8 !w-8 !p-0"
                onClick={() => setShowLeftPanel((v) => !v)}
                title={showLeftPanel ? "关闭实验参数" : "实验参数"}
                aria-label={showLeftPanel ? "关闭实验参数" : "打开实验参数"}
                aria-pressed={showLeftPanel}
              >
                {showLeftPanel ? (
                  <PanelLeftClose className="h-4 w-4" />
                ) : (
                  <PanelLeftOpen className="h-4 w-4" />
                )}
              </button>
              <button
                type="button"
                className="btn-ghost !h-8 !w-8 !p-0"
                onClick={() => setShowRightPanel((v) => !v)}
                title={showRightPanel ? "隐藏工作空间" : "显示工作空间"}
                aria-label={showRightPanel ? "隐藏工作空间" : "显示工作空间"}
                aria-pressed={showRightPanel}
              >
                {showRightPanel ? (
                  <PanelRightClose className="h-4 w-4" />
                ) : (
                  <PanelRightOpen className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {activeDim && (
            <div className="lane-row">
              <div className="lane-row-meta">
                <p className="eyebrow">参与对比</p>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {activeSelections.length} / {activeDim.max_select}
                  {activeSelections.length < (activeDim.min_select ?? 2) && (
                    <span className="text-warning">
                      {" "}
                      · 至少 {activeDim.min_select ?? 2} 项
                    </span>
                  )}
                </span>
              </div>
              <div className="lane-pick">
                {activeDim.options.map((opt, idx) => (
                  <LaneTile
                    key={opt.value}
                    option={opt}
                    selected={activeSelections.includes(opt.value)}
                    onToggle={toggleSelection}
                    lane={idx}
                  />
                ))}
              </div>
            </div>
          )}

          {meta?.baseline_fields && meta.baseline_fields.length > 0 && (
            <div className="baseline-row">
              <div className="lane-row-meta">
                <p className="eyebrow">控制变量基线</p>
                <span className="font-mono text-[10px] text-muted-foreground">
                  非对比维可改 · 当前维锁定
                </span>
              </div>
              <div className="baseline-pick">
                {meta.baseline_fields.map((field) => {
                  const locked = field.dimension === dimension;
                  const value =
                    baseline[field.field as keyof BaselineOverrides] ?? field.default;
                  return (
                    <label
                      key={field.field}
                      className="baseline-field"
                      data-locked={locked}
                      title={locked ? "当前对比维，由上方子项决定" : undefined}
                    >
                      <span className="baseline-field-label">{field.label}</span>
                      <select
                        className="baseline-select"
                        disabled={locked || running}
                        value={value}
                        onChange={(e) => {
                          const next = e.target.value;
                          setBaseline((prev) => ({
                            ...prev,
                            [field.field]: next,
                          }));
                        }}
                        aria-label={`基线 ${field.label}`}
                      >
                        {field.options.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {dimension === "prompt" && showPromptBanner && (
            <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-border bg-muted/20 px-3 py-2 text-[11px]">
              <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <p className="flex-1 leading-relaxed text-muted-foreground">
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
        </section>

        <section className="composer-bar">
          {error && (
            <p className="text-xs text-destructive border border-destructive/30 bg-destructive/5 rounded-[var(--radius-sm)] px-3 py-1.5">
              {error}
            </p>
          )}
          <div className="composer-templates">
            {TASK_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="btn-ghost text-[11px]"
                title={t.question}
                onClick={() => setQuestion(t.question)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="composer-row">
            <input
              className="form-input"
              placeholder="输入问题，折射出多条 Agent 管线…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  runArena();
                }
              }}
              disabled={running}
              aria-label="实验问题"
            />
            {running ? (
              <button type="button" className="btn-ghost composer-run" onClick={cancelRun}>
                <Square className="h-4 w-4" />
                停止
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary"
                disabled={!question.trim() || activeSelections.length < 2}
                onClick={runArena}
              >
                <Send className="h-4 w-4" />
                运行
              </button>
            )}
          </div>
        </section>
      </div>

      <div className="arena-body">
        {showLeftPanel && (
          <button
            type="button"
            className="arena-backdrop"
            aria-label="关闭实验参数"
            onClick={() => setShowLeftPanel(false)}
          />
        )}
        {!showLeftPanel && showRightPanel && (
          <button
            type="button"
            className="arena-backdrop xl:hidden"
            aria-label="关闭工作空间"
            onClick={() => setShowRightPanel(false)}
          />
        )}

        {showLeftPanel && (
          <aside className="arena-drawer" data-side="left" aria-label="实验参数">
            <div className="arena-drawer-head">
              <p className="eyebrow">实验参数</p>
              <button
                type="button"
                className="btn-ghost !h-7 !w-7 !p-0"
                onClick={() => setShowLeftPanel(false)}
                aria-label="关闭实验参数"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="arena-drawer-body">
              <ExperimentPanel dimension={dimension} columnCount={columnCount} />
            </div>
          </aside>
        )}

        <main className="arena-stage">
          <div className="arena-stage-tabs">
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
              badge={hasMetrics ? columnList.filter((c) => c.metrics).length : null}
            />
            <MainTabButton
              active={mainTab === "diff"}
              onClick={() => setMainTab("diff")}
              icon={<GitCompare className="h-3.5 w-3.5" />}
              label="Trace 对比"
              disabled={!allCompleted}
            />
          </div>

          <div className="arena-stage-body">
            {mainTab === "results" ? (
              renderResultsTab()
            ) : (
              <div className="arena-stage-scroll">
                {mainTab === "report" && hasMetrics && (
                  <div className="space-y-4">
                    <ComparisonReport columns={columns} />
                    {allCompleted && (
                      <section className="panel-surface !shadow-none p-4 space-y-3">
                        <div className="flex items-center gap-2">
                          <FolderPlus className="h-4 w-4 text-primary" />
                          <h3 className="text-sm font-semibold">保存为项目</h3>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          将本次实验的工作空间文件与对比结果写入项目列表，可在「项目」页查看。
                        </p>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            className="form-input flex-1"
                            placeholder="项目名称（可留空自动生成）"
                            value={projectName}
                            onChange={(e) => setProjectName(e.target.value)}
                            disabled={savingProject}
                            maxLength={100}
                            aria-label="项目名称"
                          />
                          <button
                            type="button"
                            className="btn-primary shrink-0"
                            disabled={savingProject || !question.trim()}
                            onClick={saveAsProject}
                          >
                            {savingProject ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <FolderPlus className="h-4 w-4" />
                            )}
                            {savingProject ? "保存中…" : "创建项目"}
                          </button>
                        </div>
                        {saveProjectMsg && (
                          <p
                            className={
                              "text-xs " +
                              (saveProjectMsg.startsWith("已保存")
                                ? "text-success"
                                : "text-destructive")
                            }
                          >
                            {saveProjectMsg}
                          </p>
                        )}
                      </section>
                    )}
                  </div>
                )}
                {mainTab === "report" && !hasMetrics && (
                  <div className="empty-state h-full min-h-[12rem]">
                    <div className="empty-state-icon">
                      <BarChart3 className="h-5 w-5" />
                    </div>
                    <p className="text-sm">暂无完成的对比数据</p>
                    <p className="text-xs text-muted-foreground">
                      运行实验后，指标会汇总到这里
                    </p>
                  </div>
                )}
                {mainTab === "diff" && allCompleted && <TraceDiff columns={columnList} />}
                {mainTab === "diff" && !allCompleted && (
                  <div className="empty-state h-full min-h-[12rem]">
                    <div className="empty-state-icon">
                      <GitCompare className="h-5 w-5" />
                    </div>
                    <p className="text-sm">等待所有 Agent 完成</p>
                    <p className="text-xs text-muted-foreground">
                      全部结束后可对齐对比 Trace
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </main>

        {showRightPanel && (
          <aside className="arena-workspace" data-open="true" aria-label="工作空间">
            <div className="arena-drawer-head xl:hidden">
              <p className="eyebrow">工作空间</p>
              <button
                type="button"
                className="btn-ghost !h-7 !w-7 !p-0"
                onClick={() => setShowRightPanel(false)}
                aria-label="关闭工作空间"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              <WorkspacePanel
                workspaceName={activeWorkspace}
                pollInterval={running ? 1500 : 5000}
              />
            </div>
          </aside>
        )}
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
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  badge?: number | string | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="main-tab"
      data-active={active}
    >
      {icon}
      {label}
      {badge != null && <span className="main-tab-badge">{badge}</span>}
    </button>
  );
}
