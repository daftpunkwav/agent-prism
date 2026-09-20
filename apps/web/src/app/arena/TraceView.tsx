/**
 * @file TraceView
 * @description Single-column trace renderer: one timeline of agent steps.
 *
 * Responsibilities:
 * - Merge events into display segments (arena-view single source)
 * - Render steps in execution order: streamed thinking (collapsed by default),
 *   tool calls (collapsed, expandable args + result), and visible answer text
 * - Keep streaming cheap: markdown blocks are memoized per text, rows re-render plain
 */

"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Lightbulb,
  Terminal,
  FileText,
  Zap,
  AlertTriangle,
  BrainCircuit,
  ChevronRight,
  Loader2,
  Eye,
  PencilLine,
  Globe,
  Bot,
  ListChecks,
  MessageCircle,
} from "lucide-react";
import type { ArenaEvent } from "@agentprism/client";
import { mergeEvents, parsePipelineBanner, type DisplaySegment } from "@agentprism/arena-view";
import { MarkdownBlock } from "@/components/MarkdownBlock";
import { PipelineConfigBadges } from "./PipelineConfigView";
import { toolCategory, type ToolCategory } from "./toolTaxonomy";
import { useT } from "@/i18n/useT";

/** The translate function handed down to module-level render helpers (they cannot call hooks). */
type Translate = ReturnType<typeof useT>;

/** Category badge color (CSS var) per tool category: visually distinct at a glance. */
const CATEGORY_COLORS: Record<ToolCategory, string> = {
  read: "var(--chart-1)",
  write: "var(--warning)",
  code: "var(--success)",
  ask: "var(--spectrum-3)",
  plan: "var(--spectrum-2)",
  net: "var(--chart-3)",
  agent: "var(--spectrum-4)",
  other: "var(--muted-foreground)",
};

/** One stable spectrum color per column */
const COLUMN_COLORS = [
  "var(--spectrum-1)",
  "var(--spectrum-2)",
  "var(--spectrum-3)",
  "var(--spectrum-4)",
];

/**
 * Single-column event trace: reasoning, tool calls, file diffs, and errors.
 *
 * @param events Arena events for one column (merged into display segments).
 * @param running Live pulse while the run streams.
 * @param colorIndex Spectrum lane index for the column.
 * @param frameworkId Driver id for foreign-banner filtering.
 */
export function TraceView({
  events,
  running,
  colorIndex = 0,
  frameworkId,
}: {
  events: ArenaEvent[];
  running: boolean;
  colorIndex?: number;
  frameworkId?: string;
}) {
  const t = useT();
  const accentColor = COLUMN_COLORS[colorIndex % COLUMN_COLORS.length] ?? "var(--chart-1)";
  // Memoized — not recomputed when the events reference is unchanged (parent updates other state)
  const segments = useMemo(() => mergeEvents(events, frameworkId), [events, frameworkId]);

  // Live follow: auto-scroll to the bottom while a segment is unfinished
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Trigger a scroll-to-bottom when segments change and a segment is unfinished
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const hasStreaming = segments.some((s) => !s.completed);
    if (hasStreaming) {
      // requestAnimationFrame guarantees execution after DOM updates
      requestAnimationFrame(() => {
        if (c) c.scrollTop = c.scrollHeight;
      });
    }
  }, [segments]);

  // The last segment is the live one while the run is ongoing (drives per-row streaming hints)
  const liveId = running && segments.length > 0 ? segments[segments.length - 1]!.id : null;

  const turns = useMemo(() => {
    const ids = [...new Set(segments.map((s) => s.turn).filter((turn) => turn > 0))];
    return ids.sort((a, b) => a - b);
  }, [segments]);
  const multiTurn = turns.length > 1 || (turns.length === 1 && turns[0]! > 1);

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-1 p-3"
      style={{ ["--lane" as string]: accentColor }}
    >
      {segments.length > 0 && (
        <div className="trace-legend" aria-hidden>
          <span className="trace-legend-item" data-kind="thinking">
            <BrainCircuit className="h-2.5 w-2.5" aria-hidden />
            {t("arena.trace.legendThinking")}
          </span>
          <span className="trace-legend-item" data-kind="answer">
            <Lightbulb className="h-2.5 w-2.5" aria-hidden />
            {t("arena.trace.legendAnswer")}
          </span>
          <span className="trace-legend-item" data-kind="tool">
            <Zap className="h-2.5 w-2.5" aria-hidden />
            {t("arena.trace.legendTool")}
          </span>
          <span className="trace-legend-item" data-kind="result">
            <Terminal className="h-2.5 w-2.5" aria-hidden />
            {t("arena.trace.legendResult")}
          </span>
        </div>
      )}
      {multiTurn
        ? (
            <>
              {turns.map((turn) => (
                <div key={`turn-${turn}`} className="trace-turn">
                  <div className="trace-turn-label">{t("arena.trace.turn", { turn })}</div>
                  <div className="trace-timeline">
                    {segments
                      .filter((s) => s.turn === turn)
                      .map((seg) => (
                        <TraceStep key={seg.id} seg={seg} accentColor={accentColor} live={seg.id === liveId} t={t} />
                      ))}
                  </div>
                </div>
              ))}
              {segments.some((s) => s.turn === 0) && (
                <div className="trace-turn">
                  <div className="trace-turn-label">{t("arena.trace.unlabeledTurn")}</div>
                  <div className="trace-timeline">
                    {segments
                      .filter((s) => s.turn === 0)
                      .map((seg) => (
                        <TraceStep key={seg.id} seg={seg} accentColor={accentColor} live={seg.id === liveId} t={t} />
                      ))}
                  </div>
                </div>
              )}
            </>
          )
        : (
            <div className="trace-timeline">
              {segments.map((seg) => (
                <TraceStep key={seg.id} seg={seg} accentColor={accentColor} live={seg.id === liveId} t={t} />
              ))}
            </div>
          )}

      {running && segments.length === 0 && <WaitingRow t={t} />}
    </div>
  );
}

/** Waiting state before the column's first event: honest copy plus an elapsed timer (the model call may stay silent for a long time). */
function WaitingRow({ t }: { t: Translate }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
      <div
        className="h-3.5 w-3.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin"
        aria-hidden
      />
      {t("arena.trace.waitingModel", { seconds })}
    </div>
  );
}

/** Timeline row for one segment; memoized so a streaming tail does not re-render settled rows. */
const TraceStep = memo(function TraceStep({
  seg,
  accentColor,
  live,
  t,
}: {
  seg: DisplaySegment;
  accentColor: string;
  live: boolean;
  t: Translate;
}) {
  if (seg.kind === "step") {
    // Settled step markers vanish: the content rows that followed carry the step themselves.
    // A live-only pending marker also disappears once the stream moved past it (e.g. an
    // unstepped error event closed the column) — a stale "calling model" row must never linger.
    if (seg.completed || !live) return null;
    return (
      <div className="trace-seg trace-step-pending flex items-center gap-1.5">
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-hidden />
        <span className="text-xs text-muted-foreground">{t("arena.trace.modelCallStep", { step: seg.step })}</span>
      </div>
    );
  }

  if (seg.kind === "thinking") {
    return (
      <details className="trace-seg trace-thinking" data-kind="thinking">
        <summary className="trace-tag cursor-pointer select-none">
          <ChevronRight className="trace-chevron" aria-hidden />
          <span className="trace-kind-badge" data-kind="thinking">
            <BrainCircuit className="h-3 w-3" aria-hidden />
            {t("arena.trace.thinkingShort")}
          </span>
          {live ? (
            <span className="ml-1.5 font-normal opacity-80">
              {t("arena.trace.thinkingStreaming")}
              <span className="trace-cursor" />
            </span>
          ) : (
            <span className="ml-1.5 font-normal text-muted-foreground font-mono">
              {t("arena.trace.thinkingChars", { count: seg.text.length })}
            </span>
          )}
        </summary>
        <pre className="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
          {seg.text}
        </pre>
      </details>
    );
  }

  if (seg.kind === "thought") {
    // Config banner: parsed framework/mode/field chips instead of a raw mono blob
    if (seg.meta) {
      const banner = parsePipelineBanner(seg.text);
      return (
        <details className="trace-seg trace-banner" data-kind="banner">
          <summary className="trace-tag cursor-pointer select-none text-muted-foreground/80">
            <ChevronRight className="trace-chevron" aria-hidden />
            <FileText className="h-3 w-3" aria-hidden />
            {banner ? banner.framework : t("arena.trace.bannerTitle")}
          </summary>
          <div className="mt-1.5">
            {banner ? (
              <PipelineConfigBadges banner={banner} />
            ) : (
              <p className="font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
                {seg.text}
              </p>
            )}
          </div>
        </details>
      );
    }
    const streaming = !seg.completed;
    const interim = !streaming && !seg.final;
    return (
      <div
        className={`trace-seg ${interim ? "trace-interim" : "trace-thought"}`}
        data-kind="answer"
        data-final={seg.final ? "true" : undefined}
        style={{ borderLeftColor: interim ? "var(--border)" : accentColor }}
      >
        <span className="trace-tag flex items-center gap-1.5 flex-wrap">
          {interim ? (
            <span className="trace-kind-badge" data-kind="interim">
              <Lightbulb className="h-3 w-3" aria-hidden />
              {t("arena.trace.interimAnswer")}
            </span>
          ) : (
            <span className="trace-kind-badge" data-kind={seg.final ? "final" : "answer"} style={{ borderColor: `color-mix(in srgb, ${accentColor} 45%, transparent)`, color: accentColor }}>
              <Lightbulb className="h-3 w-3" aria-hidden />
              {seg.final ? t("arena.trace.finalReply") : t("arena.trace.answer")}
            </span>
          )}
          <span className="font-mono text-muted-foreground">{t("arena.trace.stepAnswer", { step: seg.step })}</span>
          {streaming && <span className="ml-1 text-muted-foreground">{t("arena.trace.thinkingStreaming")}<span className="trace-cursor" /></span>}
        </span>
        <div className={`text-sm leading-relaxed ${interim ? "text-muted-foreground" : ""}`}>
          {streaming ? (
            <span className="whitespace-pre-wrap break-words">
              {seg.text}
              <span className="trace-cursor" />
            </span>
          ) : (
            <MarkdownBlock text={seg.text} />
          )}
        </div>
      </div>
    );
  }

  if (seg.kind === "action") {
    return renderAction(seg, accentColor, live, t);
  }

  if (seg.kind === "observation") {
    const result = seg.text || "";
    const isError = result.toLowerCase().startsWith("error");
    const isFileList = seg.tool === "ls";
    return (
      <div
        className={`trace-seg ${isError ? "trace-error" : "trace-observation"}`}
        data-kind={isError ? "error" : "result"}
        style={!isError ? { borderLeftColor: "var(--success)" } : undefined}
      >
        <span className="trace-tag flex items-center gap-1.5">
          <span className="trace-kind-badge" data-kind={isError ? "error" : "result"}>
            {isError ? (
              <AlertTriangle className="h-3 w-3" aria-hidden />
            ) : (
              <Terminal className="h-3 w-3" aria-hidden />
            )}
            {isError ? t("arena.trace.error") : isFileList ? t("arena.trace.fileList") : t("arena.trace.result")}
          </span>
          {!isError && seg.tool && (
            <span className="font-mono normal-case tracking-normal text-muted-foreground">← {seg.tool}</span>
          )}
        </span>
        <div className="text-sm">
          {isFileList ? (
            <div className="font-mono text-xs whitespace-pre-wrap break-words text-muted-foreground">
              {result}
            </div>
          ) : (
            <MarkdownBlock text={result} />
          )}
        </div>
      </div>
    );
  }

  if (seg.kind === "error") {
    return (
      <div className="trace-seg trace-error" data-kind="error">
        <span className="trace-tag flex items-center gap-1.5">
          <span className="trace-kind-badge" data-kind="error">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            {t("arena.trace.error")}
          </span>
        </span>
        <p className="whitespace-pre-wrap break-words text-destructive">{seg.text}</p>
      </div>
    );
  }

  if (seg.kind === "verify" || seg.kind === "reflect" || seg.kind === "harness_edit") {
    const label = seg.kind === "verify" ? t("arena.trace.verify") : seg.kind === "reflect" ? t("arena.trace.reflect") : t("arena.trace.harnessEdit");
    return (
      <div className="trace-seg" data-kind="thinking">
        <span className="trace-tag flex items-center gap-1.5 text-muted-foreground">
          <span className="trace-kind-badge" data-kind="thinking">
            <BrainCircuit className="h-3 w-3" aria-hidden />
            {label}
          </span>
        </span>
        <p className="text-sm whitespace-pre-wrap break-words text-muted-foreground">{seg.text}</p>
      </div>
    );
  }

  if (seg.kind === "tool_progress") {
    return (
      <div className="trace-seg trace-observation" data-kind="result" style={{ borderLeftColor: "var(--chart-1)" }}>
        <span className="trace-tag flex items-center gap-1.5">
          <span className="trace-kind-badge" data-kind="result">
            <Terminal className="h-3 w-3" aria-hidden />
            {t("arena.trace.toolProgress")}
          </span>
          {!seg.completed && <span className="ml-1 text-muted-foreground">{t("arena.trace.streaming")}<span className="trace-cursor" /></span>}
        </span>
        <pre className="text-xs font-mono whitespace-pre-wrap break-words text-muted-foreground max-h-48 overflow-auto">
          {seg.text}
        </pre>
      </div>
    );
  }

  if (seg.kind === "file_diff") {
    return (
      <div className="trace-seg trace-action" data-kind="tool" data-category="write" style={{ borderLeftColor: "var(--warning)" }}>
        <span className="trace-tag flex items-center gap-1.5">
          <span className="trace-kind-badge" data-category="write" style={{ borderColor: "color-mix(in srgb, var(--warning) 45%, transparent)", color: "var(--warning)" }}>
            <FileText className="h-3 w-3" aria-hidden />
            {t("arena.trace.fileDiff")}
          </span>
        </span>
        <p className="text-xs font-mono whitespace-pre-wrap break-words text-muted-foreground">
          {seg.text}
        </p>
      </div>
    );
  }

  return null;
});

/** One-line detail of a tool call: target path or first command line. */
function actionDetail(seg: DisplaySegment): string {
  const args = seg.args ?? {};
  if (typeof args.path === "string" && args.path !== "") return args.path;
  if (typeof args.command === "string" && args.command !== "") {
    const line = args.command.split("\n")[0] ?? args.command;
    return line.length > 64 ? line.slice(0, 64) + "…" : line;
  }
  const first = Object.values(args).find((value) => typeof value === "string" && value !== "");
  if (typeof first === "string") {
    const line = first.split("\n")[0] ?? first;
    return line.length > 64 ? line.slice(0, 64) + "…" : line;
  }
  return "";
}

/** Pretty-printed call arguments, truncated to keep the DOM bounded. */
function argsPreview(args: Record<string, unknown>, t: Translate): string {
  const json = JSON.stringify(args, null, 2);
  return json.length > 2000 ? json.slice(0, 2000) + "\n" + t("arena.trace.truncatedMark") : json;
}

/** Category label for a tool category (localized). */
function categoryLabel(t: Translate, category: ToolCategory): string {
  switch (category) {
    case "read":
      return t("arena.trace.fileRead");
    case "write":
      return t("arena.trace.fileWrite");
    case "code":
      return t("arena.trace.codeExec");
    case "ask":
      return t("arena.trace.askTool");
    case "plan":
      return t("arena.trace.planTool");
    case "net":
      return t("arena.trace.netTool");
    case "agent":
      return t("arena.trace.agentTool");
    default:
      return t("arena.trace.toolCall");
  }
}

/** Category icon per tool category. */
function CategoryIcon({ category, className, style }: { category: ToolCategory; className?: string; style?: React.CSSProperties }) {
  switch (category) {
    case "read":
      return <Eye className={className} style={style} aria-hidden />;
    case "write":
      return <PencilLine className={className} style={style} aria-hidden />;
    case "code":
      return <Terminal className={className} style={style} aria-hidden />;
    case "ask":
      return <MessageCircle className={className} style={style} aria-hidden />;
    case "plan":
      return <ListChecks className={className} style={style} aria-hidden />;
    case "net":
      return <Globe className={className} style={style} aria-hidden />;
    case "agent":
      return <Bot className={className} style={style} aria-hidden />;
    default:
      return <Zap className={className} style={style} aria-hidden />;
  }
}

/** Tool-call row: collapsed summary by default; the body carries args, result, and file diff. */
function renderAction(seg: DisplaySegment, accentColor: string, live: boolean, t: Translate) {
  const args = seg.args ?? {};
  const toolName = seg.tool || "unknown";
  const toolLower = toolName.toLowerCase();
  const category = toolCategory(toolLower);
  const categoryColor = CATEGORY_COLORS[category];
  const detail = actionDetail(seg);
  const result = seg.result ?? "";
  const diff = seg.diff ?? "";
  const executing = live && seg.resultDone === false;
  const isErrorResult = result.toLowerCase().startsWith("error");
  const kindLabel = categoryLabel(t, category);

  return (
    <details className="trace-seg trace-action" data-kind="tool" data-category={category} style={{ borderLeftColor: categoryColor }}>
      <summary className="trace-tag cursor-pointer select-none flex items-center gap-1.5 flex-wrap">
        <ChevronRight className="trace-chevron" aria-hidden />
        <span className="trace-kind-badge" data-category={category} style={{ borderColor: `color-mix(in srgb, ${categoryColor} 45%, transparent)`, color: categoryColor }}>
          <CategoryIcon category={category} className="h-3 w-3 shrink-0" />
          {kindLabel}
        </span>
        <span className="font-mono text-foreground">{toolName}</span>
        {detail !== "" && <span className="font-mono text-muted-foreground">{detail}</span>}
        {executing ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden />
            {t("arena.trace.actionRunning")}
          </span>
        ) : (
          result !== "" && (
            <span className={"font-mono " + (isErrorResult ? "text-destructive" : "text-muted-foreground")}>
              {t("arena.trace.actionDone")}
            </span>
          )
        )}
      </summary>
      <div className="mt-2 space-y-2 border-l border-border/60 pl-3">
        <div>
          <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{t("arena.trace.callArgs")}</p>
          <pre className="mt-1 rounded-none border border-border bg-muted/50 p-2 text-[11px] font-mono overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
            {argsPreview(args, t)}
          </pre>
        </div>
        {result !== "" && (
          <div>
            <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{t("arena.trace.callResult")}</p>
            {isErrorResult ? (
              <pre className="mt-1 rounded-none border border-destructive/30 bg-destructive/5 p-2 text-[11px] font-mono whitespace-pre-wrap break-words text-destructive max-h-48 overflow-auto">
                {result}
              </pre>
            ) : (
              <div className="mt-1 max-h-64 overflow-auto">
                <MarkdownBlock text={result} />
              </div>
            )}
          </div>
        )}
        {diff !== "" && (
          <div>
            <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{t("arena.trace.fileDiff")}</p>
            <pre className="mt-1 rounded-none border border-border bg-muted/50 p-2 text-[11px] font-mono whitespace-pre-wrap break-all text-muted-foreground max-h-48 overflow-auto">
              {diff.length > 2000 ? diff.slice(0, 2000) + "\n" + t("arena.trace.truncatedMark") : diff}
            </pre>
          </div>
        )}
      </div>
    </details>
  );
}
