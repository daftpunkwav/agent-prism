"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Gauge, Info, Loader2 } from "lucide-react";
import { fetchProvider, saveProvider } from "@/lib/api";
import type { ProviderConfig } from "@/lib/api";

interface ExperimentPanelProps {
  dimension: string;
  columnCount: number;
}

/** 粗略估计：中文每 token ≈ 1.5 字符，英文每 token ≈ 4 字符 */
function estimatePromptTokens(system: string, user: string): number {
  const total = system + user;
  if (!total) return 0;
  const cjk = (total.match(/[一-鿿]/g) || []).length;
  const nonCjk = total.length - cjk;
  return Math.ceil(cjk / 1.5 + nonCjk / 4);
}

const SAMPLE_SYSTEM =
  "你是 AgentPrism Arena 中的实验 Agent，使用 ReAct 模式完成任务。可用工具：get_current_time（获取当前时间）、calculate（计算简单数学表达式）。回答要简洁准确。需要工具时先说明理由再调用。";
const SAMPLE_USER = "Q: 现在几点？ → Thought: 需要当前时间 → Action: get_current_time";

interface ExperimentParams {
  temperature: number;
  top_p: number;
  frequency_penalty: number;
  presence_penalty: number;
  max_tokens: number;
}

const DEFAULT_PARAMS: ExperimentParams = {
  temperature: 0,
  top_p: 1,
  frequency_penalty: 0,
  presence_penalty: 0,
  max_tokens: 2048,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function ExperimentPanel({ dimension, columnCount }: ExperimentPanelProps) {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<ProviderConfig | null>(null);
  const [showEstimate, setShowEstimate] = useState(false);
  const [pending, setPending] = useState<ExperimentParams | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  // 仅在用户释放控件后才提交保存（拖动/键盘/触屏）
  const pendingRef = useRef<ExperimentParams | null>(null);

  useEffect(() => {
    // 组件卸载时取消 in-flight 请求，避免 setState on unmounted
    const ac = new AbortController();
    fetchProvider({ signal: ac.signal })
      .then((cfg) => {
        if (ac.signal.aborted) return;
        setConfig(cfg);
        setPending({
          temperature: cfg.temperature,
          top_p: cfg.top_p ?? DEFAULT_PARAMS.top_p,
          frequency_penalty: cfg.frequency_penalty ?? DEFAULT_PARAMS.frequency_penalty,
          presence_penalty: cfg.presence_penalty ?? DEFAULT_PARAMS.presence_penalty,
          max_tokens: cfg.max_output_tokens,
        });
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setError(true);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, []);

  // 仅在 columnCount 变化时重算预估（config 不参与 token 估算）
  const estimatedTokens = config
    ? estimatePromptTokens(SAMPLE_SYSTEM, SAMPLE_USER) * columnCount
    : 0;

  const flushParams = async () => {
    if (!config || pendingRef.current === null) return;
    const params = pendingRef.current;
    pendingRef.current = null;
    setSaving(true);
    setError(false);
    try {
      // saveProvider 在 lib/api.ts 内部剥离 api_key — 调用方无需关心
      const saved = await saveProvider({
        ...config,
        ...params,
        max_output_tokens: params.max_tokens,
      });
      setConfig(saved);
      setPending({
        temperature: saved.temperature,
        top_p: saved.top_p ?? params.top_p,
        frequency_penalty: saved.frequency_penalty ?? params.frequency_penalty,
        presence_penalty: saved.presence_penalty ?? params.presence_penalty,
        max_tokens: saved.max_output_tokens,
      });
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  const updateParam = <K extends keyof ExperimentParams>(
    key: K,
    value: ExperimentParams[K],
  ) => {
    setPending((prev) => {
      const next = { ...(prev ?? DEFAULT_PARAMS), [key]: value };
      pendingRef.current = next;
      return next;
    });
  };

  const params = pending ?? DEFAULT_PARAMS;

  const inputPct = useMemo(() => {
    if (!config || config.max_input_tokens <= 0) return 0;
    return Math.min(100, Math.round((estimatedTokens / config.max_input_tokens) * 100));
  }, [config, estimatedTokens]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        加载配置…
      </div>
    );
  }

  if (!config) return null;

  return (
    <div className="space-y-4">
      {/* 模型卡片：名称 + 提供商 + 上下文窗口 */}
      <div className="rounded-lg border border-border bg-card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            模型
          </span>
          {saving && <span className="text-[10px] text-muted-foreground">保存中…</span>}
          {error && <span className="text-[10px] text-destructive">保存失败</span>}
        </div>
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 flex items-center justify-center min-h-[2.25rem]">
          <span className="font-mono text-sm font-medium text-foreground text-center break-all">
            {config.model}
          </span>
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="truncate">{config.provider_name}</span>
          <span className="font-mono shrink-0">
            {(config.context_window / 1000).toFixed(0)}k ·{" "}
            {(config.max_output_tokens / 1000).toFixed(0)}k out
          </span>
        </div>
      </div>

      {/* 参数滑块组：所有滑块共享 release 时保存 */}
      <ParamSlider
        label="Temperature"
        hint="采样温度（0=精确，1=创意）"
        value={params.temperature}
        min={0}
        max={1}
        step={0.05}
        format={(v) => v.toFixed(2)}
        onChange={(v) => updateParam("temperature", v)}
        onCommit={flushParams}
      />
      <ParamSlider
        label="Top P"
        hint="核采样阈值"
        value={params.top_p}
        min={0}
        max={1}
        step={0.05}
        format={(v) => v.toFixed(2)}
        onChange={(v) => updateParam("top_p", v)}
        onCommit={flushParams}
      />
      <ParamSlider
        label="Frequency Penalty"
        hint="降低重复 token 的概率"
        value={params.frequency_penalty}
        min={-2}
        max={2}
        step={0.1}
        format={(v) => v.toFixed(1)}
        onChange={(v) => updateParam("frequency_penalty", v)}
        onCommit={flushParams}
      />
      <ParamSlider
        label="Presence Penalty"
        hint="鼓励新话题"
        value={params.presence_penalty}
        min={-2}
        max={2}
        step={0.1}
        format={(v) => v.toFixed(1)}
        onChange={(v) => updateParam("presence_penalty", v)}
        onCommit={flushParams}
      />

      {/* Max Tokens 数字输入 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Max Tokens
          </label>
          <span className="text-[11px] font-mono text-foreground">
            {params.max_tokens.toLocaleString()}
          </span>
        </div>
        <input
          type="range"
          min={64}
          max={Math.max(64000, params.max_tokens)}
          step={64}
          value={params.max_tokens}
          onChange={(e) => updateParam("max_tokens", clamp(parseInt(e.target.value, 10) || 0, 64, 128000))}
          onPointerUp={flushParams}
          aria-label="Max Tokens"
          className="w-full h-1.5 appearance-none bg-border rounded-full cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground
            [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>64</span>
          <span>上限 128k</span>
        </div>
      </div>

      {/* 预估 Token */}
      <div className="rounded border border-border bg-muted/20 p-3 space-y-2">
        <button
          type="button"
          className="flex items-center gap-1.5 w-full text-left"
          onClick={() => setShowEstimate(!showEstimate)}
          aria-expanded={showEstimate}
        >
          <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">预估消耗</span>
          <span className="text-[10px] font-mono text-muted-foreground ml-auto">
            ~{estimatedTokens.toLocaleString()} tokens
          </span>
          <Info className="h-3 w-3 text-muted-foreground" />
        </button>

        {showEstimate && (
          <div className="text-[11px] text-muted-foreground space-y-1 pt-1 border-t border-border">
            <p>预估方式：粗略字符/token 比率（中英混合）</p>
            <p>系统 prompt 约 150 tokens × {columnCount} 列 = ~{150 * columnCount} tokens</p>
            <p className="text-muted-foreground/70">
              * 实际消耗取决于模型 tokenizer 和 Agent 工具调用次数
            </p>
          </div>
        )}

        <div className="space-y-1">
          <div className="flex justify-between text-[10px]">
            <span className="text-muted-foreground">预估输入占比</span>
            <span className="font-mono">{inputPct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-border overflow-hidden">
            <div
              className="h-full bg-foreground/60 transition-all duration-300"
              style={{ width: `${inputPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* 维度说明 */}
      <div className="rounded border border-border bg-card p-3">
        <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1.5">
          当前维度
        </p>
        <p className="text-xs">{DIMENSION_DESCRIPTIONS[dimension] ?? ""}</p>
      </div>
    </div>
  );
}

/** 复用滑块组件，避免 4 个 ParamSlider 重复样板代码。 */
function ParamSlider({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
  onCommit,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  onCommit: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {label}
        </label>
        <span className="text-[11px] font-mono text-foreground">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onPointerUp={onCommit}
        aria-label={label}
        title={hint}
        className="w-full h-1.5 appearance-none bg-border rounded-full cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground
          [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background"
      />
    </div>
  );
}

const DIMENSION_DESCRIPTIONS: Record<string, string> = {
  framework: "并排运行 LangChain / LangGraph，编排实现不同，其余配置保持一致",
  prompt: "同一编排，4 种 Prompt 策略对比：Zero-shot / Few-shot / CoT / Structured",
  reasoning: "4 种推理模式对比：ReAct / CoT+Tool / ToT / Reflexion",
  context: "4 种上下文策略对比：滑动窗口 / 摘要 / 向量 / 混合",
  harness: "4 种 Harness 级别对比：裸运行 / 验证 / 反思 / 自进化",
};