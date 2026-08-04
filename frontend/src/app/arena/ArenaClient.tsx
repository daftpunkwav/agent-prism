"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import { ArenaModule } from "@/components/ArenaModule";
import { ExperimentPanel } from "@/components/ExperimentPanel";
import { TokenStatsPanel } from "@/components/TokenStatsPanel";
import { TraceDiff } from "@/components/TraceDiff";
import { TraceView } from "@/components/TraceView";
import { WorkspacePanel } from "@/components/WorkspacePanel";
import {
  ArenaEvent,
  ArenaMeta,
  BaselineOverrides,
  ChatMessage,
  DimensionId,
  DimensionOption,
  JudgeResult,
  PipelineMetrics,
  TaskTemplate,
  TokenStats,
  createProject,
  fetchArenaMeta,
  fetchTemplates,
  isAbortError,
  judgeAnswers,
  streamArenaRun,
} from "@/lib/api";

/** 对比维度 → PipelineConfig 字段（与后端 DIMENSION_FIELD 对齐） */
const DIMENSION_FIELD: Record<DimensionId, keyof BaselineOverrides> = {
  framework: "framework",
  prompt: "prompt_profile",
  reasoning: "reasoning",
  context: "context",
  harness: "harness",
  temperature: "temperature",
  model: "endpoint_id",
  thinking: "thinking_level",
  max_steps: "max_steps",
  toolset: "toolset",
};

const DIMENSION_IDS: DimensionId[] = [
  "framework",
  "prompt",
  "reasoning",
  "context",
  "harness",
  "temperature",
  "model",
  "thinking",
  "max_steps",
  "toolset",
];

const BASELINE_GROUP_LABEL: Record<string, string> = {
  pipeline: "管线",
  decode: "解码 / 思考",
  access: "接入点",
};

type ColumnState = {
  label: string;
  events: ArenaEvent[];
  metrics?: PipelineMetrics;
  tokenStats?: TokenStats;
  /** 后端实际工作空间名（来自 complete/token_update 事件） */
  workspace?: string;
  error?: string;
  /** 自动判分结果（模板任务运行完成后填充） */
  judge?: JudgeResult;
};

type MainTab = "results" | "report" | "diff";

/** 判分方式 → 展示徽章文案 */
const JUDGE_TYPE_LABEL: Record<string, string> = {
  keyword: "关键词",
  json: "JSON",
  code: "代码",
  numeric: "数字",
  exclude: "拒答检测",
  regex: "正则",
  none: "快题",
};

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

/**
 * 从列事件中提取"最终答案"用于自动判分 / 续聊历史：
 * 默认取最后一轮；可指定 turn。
 * 累积 thought / thought_delta（取最后 4000 字符），
 * 若无 thought 则回退到最后一条 observation。
 */
function extractFinalAnswer(events: ArenaEvent[], turn?: number): string {
  const target =
    turn != null
      ? turn
      : Math.max(0, ...events.map((e) => ("turn" in e ? (e.turn ?? 0) : 0)));
  let thought = "";
  let lastObs = "";
  for (const ev of events) {
    const evTurn = "turn" in ev ? (ev.turn ?? 0) : 0;
    // 指定轮次时必须严格匹配，避免 turn=0 / 其它轮污染答案
    if (target > 0 && evTurn !== target) continue;
    if (ev.type === "thought" || ev.type === "thought_delta") {
      thought = (thought + (ev.content ?? "")).slice(-4000);
    } else if (ev.type === "observation") {
      lastObs = ev.result ?? "";
    }
  }
  return (thought || lastObs).trim();
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
              <th className="!text-center">判分</th>
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
                  <td className="text-center">
                    {col.judge ? (
                      <span
                        className={
                          "inline-flex items-center gap-1 font-mono text-[10px] " +
                          (col.judge.passed ? "text-success" : "text-destructive")
                        }
                        title={col.judge.reason}
                      >
                        {col.judge.passed ? "✅" : "❌"} 判分
                      </span>
                    ) : (
                      <span className="text-muted-foreground/40 text-[10px]">—</span>
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
        {cols.some((c) => c.judge) && (
          <p className="text-[11px]">
            自动判分：
            <span className="font-medium text-foreground">
              {cols.filter((c) => c.judge?.passed).length} / {cols.filter((c) => c.judge).length}
            </span>{" "}
            通过（L1 格式/约束验证，无 LLM）
          </p>
        )}
      </div>
    </div>
  );
}

function ColumnPlaceholder({ name, lane }: { name: string; lane: number }) {
  return (
    <div className="column-card column-card-placeholder h-full" data-lane={lane % 4}>
      <div className="column-header">
        <span className="font-semibold text-sm">{name}</span>
      </div>
      <div className="flex flex-1 flex-col justify-center gap-2.5 p-5">
        <div className="shimmer h-2.5 w-[72%]" aria-hidden />
        <div className="shimmer h-2.5 w-[48%]" aria-hidden />
        <div className="shimmer h-2.5 w-[84%]" aria-hidden />
        <p className="mt-3 text-center text-[11px] text-muted-foreground">等待运行</p>
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
  isHistorySeed,
  onUseAsSeed,
}: {
  col: ColumnState;
  running: boolean;
  showStop: boolean;
  onStop: () => void;
  lane: number;
  isHistorySeed?: boolean;
  onUseAsSeed?: () => void;
}) {
  return (
    <div
      className="column-card h-full min-h-0 flex flex-col"
      data-lane={lane % 4}
      data-running={running && !col.metrics ? "true" : undefined}
    >
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
            {isHistorySeed && (
              <span className="arena-seed-badge" title="续聊历史采用本列回复">
                续聊种子
              </span>
            )}
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
        <div className="flex items-center gap-1 shrink-0">
          {onUseAsSeed && col.metrics && !isHistorySeed && (
            <button
              type="button"
              className="btn-ghost !h-7 !px-2 text-[10px]"
              onClick={onUseAsSeed}
              title="续聊时采用本列回复写入共享历史"
            >
              用作续聊
            </button>
          )}
          {showStop && (
            <button
              type="button"
              className="btn-ghost !h-7 !px-2 text-[10px]"
              onClick={onStop}
            >
              <Square className="h-3 w-3" />
              停止
            </button>
          )}
        </div>
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
      {col.judge && (
        <div
          className={
            "border-t px-3 py-2 text-[11px] shrink-0 flex items-start gap-1.5 " +
            (col.judge.passed
              ? "border-t-success/30 bg-success/5 text-success"
              : "border-t-destructive/30 bg-destructive/5 text-destructive")
          }
          title={col.judge.details.join("\n")}
        >
          <span
            aria-hidden
            className={
              "mt-1 h-1.5 w-1.5 shrink-0 rounded-full " +
              (col.judge.passed ? "bg-current" : "bg-current")
            }
          />
          <span className="min-w-0">
            <span className="font-mono font-medium">
              {col.judge.passed ? "判分通过" : "判分未通过"}
            </span>
            <span className="ml-2 text-muted-foreground">{col.judge.reason}</span>
          </span>
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
  const searchParams = useSearchParams();
  const [meta, setMeta] = useState<ArenaMeta | null>(null);
  const [dimension, setDimension] = useState<DimensionId>("framework");
  const [selections, setSelections] = useState<string[]>([]);
  const [baseline, setBaseline] = useState<BaselineOverrides>({});
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [columns, setColumns] = useState<Record<string, ColumnState>>({});
  const [showPromptBanner, setShowPromptBanner] = useState(true);
  const [showLeftPanel, setShowLeftPanel] = useState(false);
  /** 工作空间默认收起，需要时再展开 */
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [metaLoading, setMetaLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>("results");
  /** 配置类模块默认收起；结果舞台始终展开 */
  const [configOpen, setConfigOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [projectName, setProjectName] = useState("");
  const [savingProject, setSavingProject] = useState(false);
  const [saveProjectMsg, setSaveProjectMsg] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [judging, setJudging] = useState(false);
  /** 1A：各列共享的对话历史（不含本轮 question） */
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  /** 续聊时采用哪一列的回复写入历史 */
  const [historySeedLabel, setHistorySeedLabel] = useState<string | null>(null);
  const awaitingHistoryCommit = useRef<{ turn: number; question: string } | null>(
    null,
  );
  /** 当前正在跑的轮次（1-based），用于剥离/保留历史 Trace */
  const currentTurnRef = useRef(0);

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
            temperature: d.temperature,
            endpoint_id: d.endpoint_id,
            // 接入点以 endpoint_id 为准，勿再塞 model_id（会与后端校验冲突）
            thinking_level: d.thinking_level,
            top_p: d.top_p,
            frequency_penalty: d.frequency_penalty,
            presence_penalty: d.presence_penalty,
            max_output_tokens: d.max_output_tokens,
            max_steps: d.max_steps,
            toolset: d.toolset,
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

  // 加载可判分任务模板（失败不阻塞主流程）
  useEffect(() => {
    const ac = new AbortController();
    fetchTemplates({ signal: ac.signal })
      .then(setTemplates)
      .catch((err: Error) => {
        if (err.name !== "AbortError") {
          console.error("加载任务模板失败:", err);
        }
      });
    return () => ac.abort();
  }, []);

  const applyTemplate = useCallback(
    (t: TaskTemplate) => {
      setQuestion(t.question);
      setActiveTemplateId(t.id);
      // 预填建议维度与子项（快题可能无建议，保留当前选择）
      if (t.suggested_dimension) {
        setDimension(t.suggested_dimension);
      }
      if (t.suggested_selections.length >= 2) {
        setSelections(t.suggested_selections);
      }
      setError(null);
    },
    [],
  );

  // URL 参数预填（学习路径「开始这一步」跳转入口）：
  //   /arena?template=<id>      → 应用可判分模板（优先）
  //   /arena?q=<question>&dimension=<id>&selections=a,b,c → 直接预填
  const urlPrefilledRef = useRef(false);
  useEffect(() => {
    if (urlPrefilledRef.current || metaLoading) return;
    const tid = searchParams.get("template");
    // 带 template 参数但模板尚未加载完 → 等 templates 变化后重跑
    if (tid && templates.length === 0) return;
    urlPrefilledRef.current = true;
    const t = tid ? templates.find((x) => x.id === tid) : undefined;
    if (t) {
      applyTemplate(t);
      return;
    }
    const q = searchParams.get("q");
    if (q) setQuestion(q);
    const dim = searchParams.get("dimension");
    if (dim && (DIMENSION_IDS as readonly string[]).includes(dim)) {
      setDimension(dim as DimensionId);
    }
    const sel = searchParams.get("selections");
    if (sel) {
      setSelections(
        sel
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    }
  }, [searchParams, metaLoading, templates, applyTemplate]);

  const baselinePayload = useMemo(() => {
    const locked = DIMENSION_FIELD[dimension];
    const allowed = new Set(
      (meta?.baseline_fields ?? []).map((f) => f.field).filter(Boolean),
    );
    const out: BaselineOverrides = {};
    (Object.keys(baseline) as Array<keyof BaselineOverrides>).forEach((key) => {
      if (key === locked || key === "model_id") return;
      if (allowed.size > 0 && !allowed.has(key)) return;
      const val = baseline[key];
      if (typeof val === "string" && val) {
        out[key] = val;
      }
    });
    return out;
  }, [baseline, dimension, meta]);

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
    // 路由/基线级错误：提到输入条；保留已完成历史轮，仅剥离本轮
    if (event.type === "error" && (label === "system" || !label)) {
      setError(event.message || "运行错误");
      awaitingHistoryCommit.current = null;
      const turn = currentTurnRef.current;
      setColumns((prev) => {
        const next: Record<string, ColumnState> = {};
        for (const [key, col] of Object.entries(prev)) {
          next[key] = {
            ...col,
            events: col.events.filter((e) => {
              const t = "turn" in e ? (e.turn ?? 0) : 0;
              return t > 0 && t < turn;
            }),
            metrics: undefined,
            error: undefined,
            judge: undefined,
          };
        }
        return next;
      });
      setRunning(false);
      return;
    }
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
    awaitingHistoryCommit.current = null;
    const turn = currentTurnRef.current;
    setColumns((prev) => {
      const next: Record<string, ColumnState> = {};
      for (const [key, col] of Object.entries(prev)) {
        next[key] = {
          ...col,
          events: col.events.filter((e) => {
            const t = "turn" in e ? (e.turn ?? 0) : 0;
            return t > 0 && t < turn;
          }),
          metrics: col.metrics,
          error: undefined,
        };
      }
      return next;
    });
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
    judgedRef.current = null; // 新运行需重新判分
    const q = question.trim();
    const turn = Math.floor(chatHistory.length / 2) + 1;
    currentTurnRef.current = turn;
    awaitingHistoryCommit.current = { turn, question: q };
    const historySnapshot = chatHistory;

    // 多轮：保留更早轮次；剥离本轮及以后（含失败重试残留）
    setColumns((prev) => {
      const next: Record<string, ColumnState> = {};
      for (const opt of activeDim?.options ?? []) {
        if (!activeSelections.includes(opt.value)) continue;
        const old = prev[opt.label];
        const kept = (old?.events ?? []).filter((e) => {
          const t = "turn" in e ? (e.turn ?? 0) : 0;
          return t > 0 && t < turn;
        });
        next[opt.label] = {
          label: opt.label,
          events: kept,
          metrics: undefined,
          tokenStats: old?.tokenStats,
          workspace: old?.workspace,
          error: undefined,
          judge: undefined,
        };
      }
      return next;
    });
    abortRef.current = new AbortController();

    const signal = abortRef.current.signal;
    try {
      await streamArenaRun(
        q,
        dimension,
        handleEvent,
        signal,
        activeSelections,
        baselinePayload,
        undefined,
        historySnapshot,
      );
    } catch (err) {
      if (isAbortError(err) || signal.aborted) {
        awaitingHistoryCommit.current = null;
        return;
      }
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
      awaitingHistoryCommit.current = null;
    } finally {
      setRunning(false);
    }
  };

  const clearConversation = useCallback(() => {
    if (running) return;
    setChatHistory([]);
    setColumns({});
    setHistorySeedLabel(null);
    awaitingHistoryCommit.current = null;
    setError(null);
    setQuestion("");
  }, [running]);

  useEffect(() => {
    setSelections([]);
    setColumns({});
    setChatHistory([]);
    setHistorySeedLabel(null);
    awaitingHistoryCommit.current = null;
    setError(null);
    setMainTab("results");
    setProjectName("");
    setSaveProjectMsg(null);
  }, [dimension]);

  const columnList = useMemo(() => Object.values(columns), [columns]);

  const hasMetrics = columnList.some((c) => c.metrics);
  const allCompleted = columnList.length >= 2 && columnList.every((c) => c.metrics);

  // 本轮全部完成后：把 user + 种子列 assistant 写入共享历史
  useEffect(() => {
    const pending = awaitingHistoryCommit.current;
    if (!pending || running || !allCompleted) return;
    awaitingHistoryCommit.current = null;
    const seed =
      (historySeedLabel && columns[historySeedLabel]) || columnList[0];
    if (!seed) return;
    const answer = extractFinalAnswer(seed.events, pending.turn).slice(0, 4000);
    setChatHistory((h) => [
      ...h,
      { role: "user", content: pending.question },
      { role: "assistant", content: answer || "（无文本回复）" },
    ]);
    if (!historySeedLabel) setHistorySeedLabel(seed.label);
    setQuestion("");
  }, [running, allCompleted, columns, columnList, historySeedLabel]);

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
                isHistorySeed={historySeedLabel === col.label}
                onUseAsSeed={() => setHistorySeedLabel(col.label)}
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
            isHistorySeed={historySeedLabel === col.label}
            onUseAsSeed={() => setHistorySeedLabel(col.label)}
          />
        ))}
      </div>
    );
  };

  // 运行完成后若使用可判分模板，自动判分所有列
  const judgedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!allCompleted || !activeTemplateId || judging) return;
    const tpl = templates.find((t) => t.id === activeTemplateId);
    if (!tpl || tpl.judge.type === "none" || tpl.category === "quick") return;
    const runKey = `${activeTemplateId}:${question.trim()}`;
    if (judgedRef.current === runKey) return;
    const answers: Record<string, string> = {};
    for (const c of columnList) {
      const text = extractFinalAnswer(c.events);
      if (text) answers[c.label] = text;
    }
    if (Object.keys(answers).length === 0) return;
    judgedRef.current = runKey;
    setJudging(true);
    judgeAnswers(activeTemplateId, answers)
      .then((results) => {
        setColumns((prev) => {
          const next: Record<string, ColumnState> = {};
          for (const [label, col] of Object.entries(prev)) {
            next[label] = results[label] ? { ...col, judge: results[label] } : col;
          }
          return next;
        });
      })
      .catch((err: Error) => {
        console.error("判分失败:", err);
        setError(err instanceof Error ? err.message : "自动判分失败");
      })
      .finally(() => setJudging(false));
  }, [allCompleted, activeTemplateId, judging, columnList, question, templates]);

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
      <div
        className="arena-setup"
        data-running={running ? "true" : undefined}
        data-config-open={configOpen ? "true" : undefined}
      >
        <div className="arena-chrome">
        <ArenaModule
          title="实验维度"
          eyebrow="配置"
          open={configOpen}
          onToggle={() => setConfigOpen((v) => !v)}
          summary={
            <div className="arena-summary-board">
              <div className="arena-summary-dim">
                <span className="arena-summary-kicker">对比维</span>
                <span className="arena-summary-dim-label">
                  {activeDim?.label ?? "未选"}
                </span>
                {activeSelections.length > 0 && (
                  <span className="arena-summary-dim-vals">
                    {activeSelections
                      .map(
                        (v) =>
                          activeDim?.options.find((o) => o.value === v)?.label ?? v,
                      )
                      .join(" · ")}
                  </span>
                )}
              </div>
              <div className="arena-summary-groups">
                {meta?.baseline_fields &&
                  (["pipeline", "decode", "access"] as const).map((g) => {
                    const items = meta.baseline_fields!.filter(
                      (f) => (f.group || "pipeline") === g,
                    );
                    if (items.length === 0) return null;
                    return (
                      <div key={g} className="arena-summary-group" data-group={g}>
                        <span className="arena-summary-group-label">
                          {BASELINE_GROUP_LABEL[g]}
                        </span>
                        <div className="arena-summary-pills">
                          {items.map((field) => {
                            const locked = field.dimension === dimension;
                            const value =
                              baseline[field.field as keyof BaselineOverrides] ??
                              field.default;
                            const lab = locked
                              ? "对比维"
                              : (field.options.find((o) => o.value === value)?.label ??
                                value);
                            return (
                              <span
                                key={field.field}
                                className="arena-summary-pill"
                                data-locked={locked}
                                title={`${field.label}: ${lab}`}
                              >
                                <em>{field.label}</em>
                                {lab}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          }
          actions={
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
          }
        >
          <div className="arena-config-dense">
            <div className="arena-config-top">
              <label className="config-select-field">
                <span className="eyebrow">对比维度</span>
                <select
                  className="baseline-select config-select"
                  value={dimension}
                  disabled={running}
                  onChange={(e) => setDimension(e.target.value as DimensionId)}
                  aria-label="对比维度"
                >
                  {meta?.dimensions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>

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
            </div>

            {activeDim?.subtitle && (
              <p className="arena-subtitle">{activeDim.subtitle}</p>
            )}

            {dimension === "model" && meta && meta.model_compare_ready === false && (
              <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-warning/40 bg-warning/10 px-3 py-2 text-[11px]">
                <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                <p className="flex-1 leading-relaxed text-muted-foreground">
                  尚未配置足够的接入点。请到{" "}
                  <a href="/settings" className="text-primary underline-offset-2 hover:underline">
                    设置
                  </a>{" "}
                  新建跨厂接入点，或在同一接入点下「添加模型」。对比时仅切换接入点；温度 / Top P
                  等由下方基线统一钉死。
                </p>
              </div>
            )}
            {dimension === "model" && meta && meta.model_compare_ready === true && (
              <p className="text-[11px] text-muted-foreground leading-relaxed px-0.5">
                模型对比：各列接入点（厂商标识 / 地址 / model）可变；温度、Top P、思考强度
                等解码参数与控制变量基线一致。未勾选「支持思考」的接入点会强制关闭思考。
              </p>
            )}
            {dimension === "thinking" && (
              <p className="text-[11px] text-muted-foreground leading-relaxed px-0.5">
                思考强度对比：钉住接入点与其它基线，仅变 off / low / medium / high。须在
                Settings 为该模型勾选「支持思考」，否则各列都会落到关闭。
              </p>
            )}

            {meta?.baseline_fields && meta.baseline_fields.length > 0 && (
              <div className="baseline-row">
                <div className="lane-row-meta">
                  <p className="eyebrow">控制变量基线</p>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    非对比维可改 · 当前维锁定 · 分组展示
                  </span>
                </div>
                <div className="baseline-groups">
                  {(["pipeline", "decode", "access"] as const).map((g) => {
                    const items = meta.baseline_fields!.filter(
                      (f) => (f.group || "pipeline") === g,
                    );
                    if (items.length === 0) return null;
                    return (
                      <div key={g} className="baseline-group" data-group={g}>
                        <p className="baseline-group-title">{BASELINE_GROUP_LABEL[g]}</p>
                        <div className="baseline-pick">
                          {items.map((field) => {
                            const locked = field.dimension === dimension;
                            const value =
                              baseline[field.field as keyof BaselineOverrides] ??
                              field.default;
                            return (
                              <label
                                key={field.field}
                                className="baseline-field"
                                data-locked={locked}
                                title={
                                  locked ? "当前对比维，由上方子项决定" : undefined
                                }
                              >
                                <span className="baseline-field-label">
                                  {field.label}
                                  {locked ? " · 对比维" : ""}
                                </span>
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
          </div>
        </ArenaModule>
        </div>

        <section className="composer-bar">
          {error && (
            <p
              role="alert"
              className="text-xs text-destructive border border-destructive/30 bg-destructive/5 rounded-[var(--radius-sm)] px-3 py-1.5"
            >
              {error}
            </p>
          )}
          {(chatHistory.length > 0 || historySeedLabel) && (
            <div className="arena-chat-history">
              <div className="arena-chat-history-head">
                <span className="eyebrow">对话历史</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {Math.floor(chatHistory.length / 2)} 轮
                  {historySeedLabel ? ` · 种子「${historySeedLabel}」` : ""}
                </span>
                <button
                  type="button"
                  className="btn-ghost !h-6 !px-2 text-[10px] ml-auto"
                  onClick={clearConversation}
                  disabled={running}
                >
                  新对话
                </button>
              </div>
              <ol className="arena-chat-history-list">
                {chatHistory.map((m, i) => (
                  <li key={`${m.role}-${i}`} data-role={m.role}>
                    <span className="arena-chat-role">
                      {m.role === "user" ? "你" : historySeedLabel || "助手"}
                    </span>
                    <span className="arena-chat-content">{m.content}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="arena-run-strip">
            <span className="eyebrow arena-run-strip-label" id="arena-template-label">
              任务模板
            </span>
            <select
              className="baseline-select arena-run-strip-select"
              value={activeTemplateId ?? ""}
              disabled={running || templates.length === 0}
              onChange={(e) => {
                const id = e.target.value;
                if (!id) {
                  setActiveTemplateId(null);
                  return;
                }
                const t = templates.find((x) => x.id === id);
                if (t) applyTemplate(t);
              }}
              aria-labelledby="arena-template-label"
            >
              <option value="">自定义问题</option>
              {templates.some((t) => (t.category ?? "scored") === "scored") && (
                <optgroup label="可判分">
                  {templates
                    .filter((t) => (t.category ?? "scored") === "scored")
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {JUDGE_TYPE_LABEL[t.judge.type]
                          ? `（${JUDGE_TYPE_LABEL[t.judge.type]}）`
                          : ""}
                      </option>
                    ))}
                </optgroup>
              )}
              {templates.some((t) => t.category === "quick") && (
                <optgroup label="快题">
                  {templates
                    .filter((t) => t.category === "quick")
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </optgroup>
              )}
            </select>
            <input
              className="form-input arena-run-strip-input"
              placeholder={
                chatHistory.length > 0
                  ? "继续追问（各列共享上方对话历史）…"
                  : "输入问题，折射出多条 Agent 管线…"
              }
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (activeSelections.length < 2) {
                    setConfigOpen(true);
                    setError("请至少选择 2 个对比项后再运行");
                    return;
                  }
                  void runArena();
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
                className="btn-primary composer-run"
                disabled={!question.trim()}
                title={
                  activeSelections.length < 2
                    ? "请先展开「实验维度」并至少选择 2 项"
                    : undefined
                }
                onClick={() => {
                  if (activeSelections.length < 2) {
                    setConfigOpen(true);
                    setError("请至少选择 2 个对比项后再运行");
                    return;
                  }
                  void runArena();
                }}
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
          <div className="arena-stage-toolbar">
            <div className="arena-stage-banner">
              <span className="eyebrow">输出</span>
              <span className="arena-stage-banner-title">结果</span>
            </div>
            <div role="tablist" aria-label="Arena 视图切换" className="arena-stage-tabs">
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
          </div>

          <div className="arena-stage-body">
            {mainTab === "results" ? (
              <div key="results" className="arena-tab-pane fade-in h-full min-h-0">
                {renderResultsTab()}
              </div>
            ) : (
              <div key={mainTab} className="arena-stage-scroll arena-tab-pane fade-in">
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
      className="main-tab"
      title={disabled ? disabledReason : undefined}
      data-active={active}
    >
      {icon}
      {label}
      {badge != null && <span className="main-tab-badge">{badge}</span>}
    </button>
  );
}
