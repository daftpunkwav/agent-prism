import type { TokenStats } from "@/lib/api";

export function TokenStatsPanel({
  stats,
  compact = false,
}: {
  stats: TokenStats;
  compact?: boolean;
}) {
  const contextPct = stats.context_usage_pct ?? 0;
  const inputPct = stats.input_usage_pct ?? 0;

  if (compact) {
    return (
      <div className="font-mono text-[10px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
        <span>入 {stats.input_tokens}</span>
        <span>出 {stats.output_tokens}</span>
        <span>计 {stats.total_tokens}</span>
        <span>上下文 {contextPct}%</span>
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t border-border px-3 py-3 text-xs">
      <div className="grid grid-cols-3 gap-2 font-mono">
        <Stat label="输入" value={stats.input_tokens} sub={`上限 ${formatK(stats.max_input_tokens)}`} />
        <Stat label="输出" value={stats.output_tokens} sub={`上限 ${formatK(stats.max_output_tokens)}`} />
        <Stat label="合计" value={stats.total_tokens} sub={`窗口 ${formatK(stats.context_window)}`} />
      </div>
      <div className="space-y-1">
        <div className="flex justify-between text-muted-foreground">
          <span>上下文占比</span>
          <span>{contextPct}%</span>
        </div>
        <div className="token-bar">
          <div className="token-bar-fill" style={{ width: `${Math.min(contextPct, 100)}%` }} />
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex justify-between text-muted-foreground">
          <span>输入占比（相对最大输入）</span>
          <span>{inputPct}%</span>
        </div>
        <div className="token-bar">
          <div className="token-bar-fill opacity-60" style={{ width: `${Math.min(inputPct, 100)}%` }} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{value.toLocaleString()}</div>
      <div className="text-[10px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function formatK(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
}
