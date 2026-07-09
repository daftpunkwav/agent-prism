"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Lightbulb,
  Terminal,
  FileText,
  Zap,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { ArenaEvent } from "@/lib/api";

const TICK_MS = 24;

function charsPerTick(len: number): number {
  return Math.max(1, Math.ceil(len / 50));
}

function isThought(ev: ArenaEvent): boolean {
  return ev.type === "thought" && ev.step !== 0;
}

/** 每列分配一个稳定的颜色索引 */
const COLUMN_COLORS = [
  "var(--chart-1)", // 白/黑
  "var(--chart-2)", // 灰
  "var(--chart-3)", // 浅灰
  "var(--chart-4)", // 更浅灰
];

export function TraceView({
  events,
  running,
  colorIndex = 0,
}: {
  events: ArenaEvent[];
  running: boolean;
  colorIndex?: number;
}) {
  const segments = events.filter(
    (ev) => ev.type !== "complete" && ev.type !== "token_update"
  );

  const playIndexRef = useRef(0);
  const typedRef = useRef(0);
  const tickRef = useRef<number>(0);
  const segmentsRef = useRef(segments);
  const runningRef = useRef(running);
  // 仅用于驱动打字机逐帧重渲，使用 setState 函数式 setter 避免额外 reducer
  const [, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick((x) => x + 1), []);
  const accentColor = COLUMN_COLORS[colorIndex % COLUMN_COLORS.length];

  segmentsRef.current = segments;
  runningRef.current = running;

  const releasable = running
    ? Math.max(0, segments.length - 1)
    : segments.length;

  const tick = useCallback(() => {
    const segs = segmentsRef.current;
    const idx = playIndexRef.current;
    const runningNow = runningRef.current;
    const rel = runningNow ? Math.max(0, segs.length - 1) : segs.length;

    if (idx >= rel) {
      tickRef.current = requestAnimationFrame(tick);
      return;
    }

    const seg = segs[idx];
    if (!seg) {
      tickRef.current = requestAnimationFrame(tick);
      return;
    }

    if (!isThought(seg)) {
      playIndexRef.current = idx + 1;
      typedRef.current = 0;
      tickRef.current = requestAnimationFrame(tick);
      return;
    }

    const text = seg.content ?? "";
    if (typedRef.current >= text.length) {
      playIndexRef.current = idx + 1;
      typedRef.current = 0;
      tickRef.current = requestAnimationFrame(tick);
      return;
    }

    typedRef.current = Math.min(
      typedRef.current + charsPerTick(text.length),
      text.length
    );
    forceUpdate();
    tickRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    tickRef.current = requestAnimationFrame(tick);
    return () => {
      if (tickRef.current) cancelAnimationFrame(tickRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const visibleCount = running
    ? Math.max(0, segments.length - 1)
    : segments.length;

  return (
    <div className="flex flex-col gap-2.5 p-3">
      {segments.map((ev, idx) => {
        if (idx > visibleCount) return null;
        const isCurrent = idx === playIndexRef.current;
        if (isCurrent && playIndexRef.current >= releasable && running) return null;

        // 系统提示
        if (ev.type === "thought" && ev.step === 0) {
          return (
            <div key={idx} className="trace-system">
              {ev.content}
            </div>
          );
        }

        // 推理段 — Markdown 渲染 + 打字机
        if (ev.type === "thought") {
          const text = ev.content ?? "";
          const showCount = isCurrent ? typedRef.current : text.length;
          const shown = text.slice(0, showCount);
          const typing = isCurrent && typedRef.current < text.length;

          return (
            <div
              key={idx}
              className="trace-seg trace-thought"
              style={{ borderLeftColor: accentColor }}
            >
              <span className="trace-tag flex items-center gap-1">
                <Lightbulb className="h-3 w-3" style={{ color: accentColor }} />
                Step {ev.step}
              </span>
              <div className="text-sm leading-relaxed">
                {typing ? (
                  <span className="whitespace-pre-wrap break-words">{shown}</span>
                ) : (
                  <div className="prose prose-sm dark:prose-invert max-w-none
                    prose-p:my-1 prose-p:text-foreground
                    prose-pre:my-2 prose-pre:rounded prose-pre:border prose-pre:border-border
                    prose-code:text-xs prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:bg-muted
                    prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5
                    prose-headings:my-1 prose-headings:text-foreground">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {shown}
                    </ReactMarkdown>
                  </div>
                )}
                {typing && <span className="trace-cursor" />}
              </div>
            </div>
          );
        }

        // 工具调用段
        if (ev.type === "action") {
          const args = ev.args ?? {};
          const toolName = ev.tool || "unknown";
          const isFileOp = ["write_file", "create_file", "read_file", "list_files", "delete_file"].includes(toolName);
          const isCodeExec = toolName === "run_code";

          let displayArgs: React.ReactNode = null;

          if (isFileOp && toolName !== "list_files" && toolName !== "read_file") {
            const content = (args.content as string) || (args.input as Record<string, string>)?.["content"] || "";
            if (content) {
              displayArgs = (
                <details className="mt-2">
                  <summary className="trace-tag cursor-pointer flex items-center gap-1 select-none">
                    <FileText className="h-3 w-3" />
                    文件内容预览
                  </summary>
                  <pre className="mt-1.5 rounded border border-border bg-muted/50 p-2.5 text-[11px] font-mono overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
                    {content.length > 500 ? content.slice(0, 500) + "\n...[截断]" : content}
                  </pre>
                </details>
              );
            }
          }

          if (isCodeExec) {
            const code = (args.code as string) || (args.input as Record<string, string>)?.["code"] || "";
            if (code) {
              displayArgs = (
                <details className="mt-2">
                  <summary className="trace-tag cursor-pointer flex items-center gap-1 select-none">
                    <Terminal className="h-3 w-3" />
                    执行代码
                  </summary>
                  <pre className="mt-1.5 rounded border border-border bg-muted/50 p-2.5 text-[11px] font-mono overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">
                    {code.length > 500 ? code.slice(0, 500) + "\n...[截断]" : code}
                  </pre>
                </details>
              );
            }
          }

          const argKeys = Object.keys(args);
          const firstKey = argKeys[0];
          const firstVal = firstKey ? args[firstKey] : null;

          return (
            <div key={idx} className="trace-seg trace-action">
              <span className="trace-tag flex items-center gap-1">
                <Zap className="h-3 w-3" style={{ color: accentColor }} />
                {isFileOp ? "文件操作" : isCodeExec ? "代码执行" : "调用工具"}
              </span>
              <p className="font-mono text-xs break-all text-foreground font-medium">
                {toolName}
              </p>
              {firstVal != null && !isFileOp && !isCodeExec && (
                <pre className="mt-1.5 rounded border border-border bg-muted/50 p-2 text-[11px] font-mono overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap break-all">
                  {typeof firstVal === "string"
                    ? firstVal.length > 200 ? firstVal.slice(0, 200) + "..." : firstVal
                    : JSON.stringify(firstVal, null, 2).slice(0, 200)}
                </pre>
              )}
              {displayArgs}
            </div>
          );
        }

        // 工具结果段
        if (ev.type === "observation") {
          const result = ev.result || "";
          const isError = result.toLowerCase().startsWith("错误") || result.toLowerCase().startsWith("error");
          const isFileList = result.includes("📄") || result.includes("(目录为空") || result.includes("📁");

          return (
            <div
              key={idx}
              className={`trace-seg ${isError ? "trace-error" : "trace-observation"}`}
              style={!isError ? { borderLeftColor: accentColor } : undefined}
            >
              <span className="trace-tag flex items-center gap-1">
                {isError ? (
                  <AlertTriangle className="h-3 w-3" />
                ) : (
                  <Terminal className="h-3 w-3" style={{ color: accentColor }} />
                )}
                {isError ? "错误" : isFileList ? "文件列表" : "结果"}
              </span>
              <div className="text-sm">
                {isFileList ? (
                  <div className="font-mono text-xs whitespace-pre-wrap break-words text-muted-foreground">
                    {result}
                  </div>
                ) : (
                  <div className="prose prose-sm dark:prose-invert max-w-none
                    prose-p:my-1 prose-p:text-foreground
                    prose-pre:my-2 prose-pre:rounded prose-pre:border prose-pre:border-border
                    prose-code:text-xs prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:bg-muted">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {result}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          );
        }

        // 错误段
        if (ev.type === "error") {
          return (
            <div key={idx} className="trace-seg trace-error">
              <span className="trace-tag flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                错误
              </span>
              <p className="whitespace-pre-wrap break-words text-destructive">{ev.message}</p>
            </div>
          );
        }

        return null;
      })}
      {running && playIndexRef.current === 0 && segments.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
          <div className="h-3.5 w-3.5 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin" />
          连接模型中…
        </div>
      )}
    </div>
  );
}
