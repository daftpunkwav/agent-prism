"use client";

import { useEffect, useRef, useState } from "react";
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

export function ExperimentPanel({ dimension, columnCount }: ExperimentPanelProps) {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<ProviderConfig | null>(null);
  const [showEstimate, setShowEstimate] = useState(false);
  const [savingTemp, setSavingTemp] = useState(false);
  const [tempError, setTempError] = useState(false);
  // 仅在拖动结束后才提交保存，避免每次 onChange 都触发 PUT 请求
  const pendingTempRef = useRef<number | null>(null);

  useEffect(() => {
    fetchProvider()
      .then(setConfig)
      .finally(() => setLoading(false));
  }, []);

  // 仅在 columnCount 变化时重算预估（config 不参与 token 估算）
  const estimatedTokens = config
    ? estimatePromptTokens(SAMPLE_SYSTEM, SAMPLE_USER) * columnCount
    : 0;

  const flushTemperature = async () => {
    if (!config || pendingTempRef.current === null) return;
    const value = pendingTempRef.current;
    pendingTempRef.current = null;
    setSavingTemp(true);
    setTempError(false);
    try {
      const saved = await saveProvider({ ...config, temperature: value, api_key: "" });
      setConfig(saved);
    } catch {
      setTempError(true);
    } finally {
      setSavingTemp(false);
    }
  };

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
      {/* 模型信息 */}
      <div className="space-y-2">
        <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          模型
        </label>
        <div className="flex items-center gap-2">
          <div className="form-input !h-9 flex-1 bg-muted/50 text-xs font-mono">
            {config.model}
          </div>
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
            {config.provider_name}
          </span>
        </div>
      </div>

      {/* Temperature */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Temperature
          </label>
          <span className="text-xs font-mono">
            {savingTemp ? "保存中…" : config.temperature}
            {tempError && <span className="ml-1 text-destructive">保存失败</span>}
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={config.temperature}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            pendingTempRef.current = v;
            setConfig({ ...config, temperature: v });
          }}
          // 拖动/键盘/触屏释放时统一提交 — 避免 onKeyUp 在长按方向键时反复触发
          onPointerUp={flushTemperature}
          aria-label="Temperature 调节"
          className="w-full h-1.5 appearance-none bg-border rounded-full cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground
            [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>精确 (0)</span>
          <span>创意 (1)</span>
        </div>
      </div>

      {/* 上下文窗口 */}
      <div className="space-y-2">
        <label className="block text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          上下文窗口
        </label>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <ContextStat label="窗口" tokens={config.context_window} />
          <ContextStat label="最大输入" tokens={config.max_input_tokens} />
          <ContextStat label="最大输出" tokens={config.max_output_tokens} />
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
            <span className="font-mono">
              {config.max_input_tokens > 0
                ? Math.min(100, Math.round((estimatedTokens / config.max_input_tokens) * 100))
                : 0}
              %
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-border overflow-hidden">
            <div
              className="h-full bg-foreground/60 transition-all duration-300"
              style={{
                width: `${Math.min(100, (estimatedTokens / (config.max_input_tokens || 1)) * 100)}%`,
              }}
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

function ContextStat({ label, tokens }: { label: string; tokens: number }) {
  return (
    <div className="rounded border border-border bg-muted/30 p-2 text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-mono text-xs mt-0.5">{(tokens / 1000).toFixed(0)}k</div>
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
