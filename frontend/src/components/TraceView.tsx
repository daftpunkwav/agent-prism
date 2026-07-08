"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { Terminal, FileText, Lightbulb, Zap, AlertTriangle } from "lucide-react";
import { ArenaEvent } from "@/lib/api";

const TICK_MS = 24;

function charsPerTick(len: number): number {
  return Math.max(1, Math.ceil(len / 60));
}

function isThought(ev: ArenaEvent): boolean {
  return ev.type === "thought" && ev.step !== 0;
}

// 简单语法高亮（基于正则）
function highlightCode(code: string, language?: string): string {
  if (!language || language === "text" || language === "plaintext") {
    return code;
  }
  // 极简高亮：关键词 + 字符串 + 注释
  let html = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Python 关键字
  const keywords = /\b(import|from|def|class|return|if|else|elif|for|while|try|except|with|as|pass|break|continue|in|not|and|or|is|None|True|False|yield|lambda|raise|finally|async|await)\b/g;

  // 注释
  html = html.replace(/(#.*$)/gm, '<span class="hl-comment">$1</span>');
  // 字符串
  html = html.replace(/("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, '<span class="hl-string">$1</span>');
  // 数字
  html = html.replace(/\b(\d+\.?\d*)\b/g, '<span class="hl-number">$1</span>');
  // 关键字
  html = html.replace(keywords, '<span class="hl-keyword">$1</span>');

  return html;
}

export function TraceView({ events, running }: { events: ArenaEvent[]; running: boolean }) {
  // 过滤不需要显示的段
  const segments = events.filter(
    (ev) => ev.type !== "complete" && ev.type !== "token_update"
  );

  const playIndexRef = useRef(0);
  const typedRef = useRef(0);
  const tickRef = useRef<number>(0);
  const segmentsRef = useRef(segments);
  const runningRef = useRef(running);
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

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
    <div className="flex flex-col gap-2 p-3">
      {segments.map((ev, idx) => {
        if (idx > visibleCount) return null;
        const isCurrent = idx === playIndexRef.current;
        if (isCurrent && playIndexRef.current >= releasable && running) return null;

        // 系统提示（step=0 的 thought）
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
            <div key={idx} className="trace-seg trace-thought">
              <span className="trace-tag flex items-center gap-1">
                <Lightbulb className="h-3 w-3" />
                推理
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

          let argStr = "";
          let displayArgs: React.ReactNode = null;

          if (isFileOp && toolName !== "list_files" && toolName !== "read_file") {
            const content = (args.content as string) || (args.input as Record<string, string>)?.["content"] || "";
            if (content) {
              displayArgs = (
                <details className="mt-1.5">
                  <summary className="trace-tag cursor-pointer flex items-center gap-1">
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
                <details className="mt-1.5">
                  <summary className="trace-tag cursor-pointer flex items-center gap-1">
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
                <Zap className="h-3 w-3" />
                {isFileOp ? "文件操作" : isCodeExec ? "代码执行" : "调用工具"}
              </span>
              <p className="font-mono text-xs break-all text-foreground font-medium">
                {toolName}
              </p>
              {firstVal != null && !isFileOp && !isCodeExec && (
                <pre className="mt-1 rounded border border-border bg-muted/50 p-2 text-[11px] font-mono overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap break-all">
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
            <div key={idx} className={`trace-seg ${isError ? "trace-error" : "trace-observation"}`}>
              <span className="trace-tag flex items-center gap-1">
                {isError ? <AlertTriangle className="h-3 w-3" /> : <Terminal className="h-3 w-3" />}
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
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <div className="h-3 w-3 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin" />
          连接模型中…
        </div>
      )}
    </div>
  );
}
