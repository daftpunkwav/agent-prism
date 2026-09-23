/**
 * @file TokenStatsPanel
 * @description Token usage display panel for the shared UI package.
 *
 * Responsibilities:
 * - Render compact inline and full variants of run token stats
 *
 * All visible copy arrives via props.labels so the package stays locale-free;
 * defaults are short neutral English.
 */

"use client";

import type { TokenStats } from "@agentprism/contracts";

/** Host-injected copy; the ui package never owns product wording. */
export type TokenStatsLabels = {
  /** Compact variant prefixes. */
  compactInput: string;
  compactOutput: string;
  compactTotal: string;
  compactContext: string;
  /** Full variant labels. */
  input: string;
  output: string;
  total: string;
  /** Prefix for caps, e.g. "Cap 12k". */
  cap: string;
  /** Prefix for the context window, e.g. "Window 128k". */
  window: string;
  contextShare: string;
  inputShare: string;
};

const DEFAULT_LABELS: TokenStatsLabels = {
  compactInput: "In",
  compactOutput: "Out",
  compactTotal: "Total",
  compactContext: "Ctx",
  input: "Input",
  output: "Output",
  total: "Total",
  cap: "Cap",
  window: "Window",
  contextShare: "Context share",
  inputShare: "Input share (of max input)",
};

/** Clamp a percentage into valid CSS range; guards against bad upstream values. */
function clampPct(pct: number) {
  return Math.max(0, Math.min(100, pct));
}

/** Compact value: large counts shrink to k-form ("24.2k") so one narrow column fits one line. */
function formatCompact(n: number) {
  if (n >= 1000) {
    const k = n / 1000;
    const rounded = k >= 100 ? Math.round(k) : Number(k.toFixed(1));
    return `${rounded}k`;
  }
  return n.toLocaleString();
}

/** Token usage display: compact inline summary or the full labeled breakdown. */
export function TokenStatsPanel({
  stats,
  compact = false,
  labels = DEFAULT_LABELS,
}: {
  stats: TokenStats;
  compact?: boolean;
  labels?: TokenStatsLabels;
}) {
  const contextPct = stats.context_usage_pct ?? 0;
  const inputPct = stats.input_usage_pct ?? 0;

  if (compact) {
    // Single-line chips (k-formatted, exact values in the hover title); wraps to a
    // second line only in very narrow columns instead of stacking four rows.
    const items = [
      { label: labels.compactInput, value: stats.input_tokens },
      { label: labels.compactOutput, value: stats.output_tokens },
      { label: labels.compactTotal, value: stats.total_tokens },
    ] as const;
    return (
      <div className="token-compact font-mono text-[11px] text-muted-foreground">
        {items.map((item) => (
          <span key={item.label} className="token-compact-item" title={`${item.label}: ${item.value.toLocaleString()}`}>
            {item.label} {formatCompact(item.value)}
          </span>
        ))}
        <span className="token-compact-item" title={`${labels.compactContext}: ${contextPct}%`}>
          {labels.compactContext} {contextPct}%
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t border-border px-3 py-3 text-xs">
      <div className="grid grid-cols-3 gap-2 font-mono">
        <Stat label={labels.input} value={stats.input_tokens} sub={`${labels.cap} ${formatK(stats.max_input_tokens)}`} />
        <Stat label={labels.output} value={stats.output_tokens} sub={`${labels.cap} ${formatK(stats.max_output_tokens)}`} />
        <Stat label={labels.total} value={stats.total_tokens} sub={`${labels.window} ${formatK(stats.context_window)}`} />
      </div>
      <div className="space-y-1">
        <div className="flex justify-between text-muted-foreground">
          <span>{labels.contextShare}</span>
          <span>{contextPct}%</span>
        </div>
        <div className="token-bar">
          {/* scaleX instead of width: progress updates animate transform-only. */}
          <div className="token-bar-fill" style={{ transform: `scaleX(${clampPct(contextPct) / 100})` }} />
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex justify-between text-muted-foreground">
          <span>{labels.inputShare}</span>
          <span>{inputPct}%</span>
        </div>
        <div className="token-bar">
          <div className="token-bar-fill opacity-60" style={{ transform: `scaleX(${clampPct(inputPct) / 100})` }} />
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
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

/** Compact cap/window label: 1500 → "1.5k", 128000 → "128k". */
function formatK(n: number) {
  if (n >= 1000) {
    const k = n / 1000;
    const rounded = k >= 100 ? Math.round(k) : Number(k.toFixed(1));
    return `${rounded}k`;
  }
  return String(n);
}
