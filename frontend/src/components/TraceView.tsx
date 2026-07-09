"use client";

import { useEffect, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Lightbulb,
  Terminal,
  FileText,
  Zap,
  AlertTriangle,
} from "lucide-react";
import { ArenaEvent } from "@/lib/api";

/** 把所有事件归并成"显示段":每段有稳定 id + 文本 + 状态。 */
type SegmentKind = "thought" | "action" | "observation" | "error" | "verify" | "reflect";

interface DisplaySegment {
  id: string;
  kind: SegmentKind;
  step: number;
  text: string; // 完整文本(thought 边收 delta 边累积)
  tool?: string;
  args?: Record<string, unknown>;
  result?: string;
  completed: boolean; // true 表示 thought_end / action / observation 等终态
}

/** 将 events 增量归并为 segments。支持 thought_delta 实时累积。 */
function mergeEvents(events: ArenaEvent[]): DisplaySegment[] {
  const segs: DisplaySegment[] = [];
  // 用 `${type}:${step}` 作 key，thought_delta 同 step 累积到既有段
  for (const ev of events) {
    // 判别联合：只有带 step 的事件类型才能取 step
    const step = "step" in ev ? (ev.step ?? 0) : 0;
    const key = `${ev.type}:${step}`;
    if (ev.type === "thought") {
      segs.push({
        id: `t:${ev.type}:${segs.length}`,
        kind: "thought",
        step,
        text: ev.content || "",
        completed: true,
      });
    } else if (ev.type === "thought_delta") {
      // 找最近一个同 step 的 thought，未完成则追加
      const tail = [...segs].reverse().find((s) => s.kind === "thought" && s.step === step && !s.completed);
      if (tail) {
        tail.text += ev.content || "";
      } else {
        segs.push({
          id: `t:${ev.type}:${segs.length}`,
          kind: "thought",
          step,
          text: ev.content || "",
          completed: false,
        });
      }
    } else if (ev.type === "thought_end") {
      const tail = [...segs].reverse().find((s) => s.kind === "thought" && s.step === step && !s.completed);
      if (tail) tail.completed = true;
    } else if (ev.type === "action") {
      segs.push({
        id: key + ":" + segs.length,
        kind: "action",
        step,
        text: "",
        tool: ev.tool,
        args: ev.args,
        completed: true,
      });
    } else if (ev.type === "observation") {
      segs.push({
        id: key + ":" + segs.length,
        kind: "observation",
        step,
        text: ev.result || "",
        completed: true,
      });
    } else if (ev.type === "error") {
      segs.push({
        id: key + ":" + segs.length,
        kind: "error",
        step,
        text: ev.message || "",
        completed: true,
      });
    } else if (ev.type === "verify") {
      segs.push({
        id: key + ":" + segs.length,
        kind: "verify",
        step,
        text: ev.content || "",
        completed: true,
      });
    } else if (ev.type === "reflect") {
      segs.push({
        id: key + ":" + segs.length,
        kind: "reflect",
        step,
        text: ev.content || "",
        completed: true,
      });
    }
    // 忽略 complete / token_update 等纯元数据
  }
  return segs;
}

/** 每列分配一个稳定的颜色索引 */
const COLUMN_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
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
  const accentColor = COLUMN_COLORS[colorIndex % COLUMN_COLORS.length] ?? "var(--chart-1)";
  // 用 useMemo 缓存 — events 引用未变时（父组件其它 state 更新）不重算
  const segments = useMemo(() => mergeEvents(events), [events]);

  // 实时跟随:若有未完成 thought,容器自动滚到底部
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 当 segments 变化且有未完成段,触发滚到底部
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const hasStreaming = segments.some((s) => !s.completed);
    if (hasStreaming) {
      // requestAnimationFrame 保证在 DOM 更新后执行
      requestAnimationFrame(() => {
        if (c) c.scrollTop = c.scrollHeight;
      });
    }
  }, [segments]);

  return (
    <div ref={containerRef} className="flex flex-col gap-2.5 p-3">
      {segments.map((seg) => renderSegment(seg, accentColor))}

      {running && segments.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
          <div className="h-3.5 w-3.5 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin" />
          连接模型中…
        </div>
      )}
    </div>
  );
}

function renderSegment(seg: DisplaySegment, accentColor: string) {
  if (seg.kind === "thought") {
    const streaming = !seg.completed;
    return (
      <div
        key={seg.id}
        className="trace-seg trace-thought"
        style={{ borderLeftColor: accentColor }}
      >
        <span className="trace-tag flex items-center gap-1">
          <Lightbulb className="h-3 w-3" style={{ color: accentColor }} />
          Step {seg.step}
          {streaming && <span className="ml-1 text-muted-foreground">· 思考中</span>}
        </span>
        <div className="text-sm leading-relaxed">
          {streaming ? (
            <span className="whitespace-pre-wrap break-words">
              {seg.text}
              <span className="trace-cursor" />
            </span>
          ) : (
            <div
              className="prose prose-sm dark:prose-invert max-w-none
                prose-p:my-1 prose-p:text-foreground
                prose-pre:my-2 prose-pre:rounded prose-pre:border prose-pre:border-border
                prose-code:text-xs prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:bg-muted
                prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5
                prose-headings:my-1 prose-headings:text-foreground"
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{seg.text}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (seg.kind === "action") {
    const args = seg.args ?? {};
    const toolName = seg.tool || "unknown";
    const isFileOp = ["write_file", "create_file", "read_file", "list_files", "delete_file"].includes(toolName);
    const isCodeExec = toolName === "run_code";

    let displayArgs: React.ReactNode = null;
    if (isFileOp && toolName !== "list_files" && toolName !== "read_file") {
      const content = (args.content as string) || "";
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
      const code = (args.code as string) || "";
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
    // 安全 stringify：firstVal 在 noUncheckedIndexedAccess 下是 T | undefined
    const stringifiedFirst = (() => {
      if (firstVal == null) return "";
      const json = JSON.stringify(firstVal, null, 2);
      return json.length > 200 ? json.slice(0, 200) : json;
    })();
    return (
      <div key={seg.id} className="trace-seg trace-action">
        <span className="trace-tag flex items-center gap-1">
          <Zap className="h-3 w-3" style={{ color: accentColor }} />
          {isFileOp ? "文件操作" : isCodeExec ? "代码执行" : "调用工具"}
        </span>
        <p className="font-mono text-xs break-all text-foreground font-medium">{toolName}</p>
        {firstVal != null && !isFileOp && !isCodeExec && (
          <pre className="mt-1.5 rounded border border-border bg-muted/50 p-2 text-[11px] font-mono overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap break-all">
            {typeof firstVal === "string"
              ? firstVal.length > 200 ? firstVal.slice(0, 200) + "..." : firstVal
              : stringifiedFirst}
          </pre>
        )}
        {displayArgs}
      </div>
    );
  }

  if (seg.kind === "observation") {
    const result = seg.text || "";
    const isError = result.toLowerCase().startsWith("错误") || result.toLowerCase().startsWith("error");
    const isFileList = result.includes("📄") || result.includes("(目录为空") || result.includes("📁");
    return (
      <div
        key={seg.id}
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
            <div
              className="prose prose-sm dark:prose-invert max-w-none
                prose-p:my-1 prose-p:text-foreground
                prose-pre:my-2 prose-pre:rounded prose-pre:border prose-pre:border-border
                prose-code:text-xs prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:bg-muted"
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (seg.kind === "error") {
    return (
      <div key={seg.id} className="trace-seg trace-error">
        <span className="trace-tag flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          错误
        </span>
        <p className="whitespace-pre-wrap break-words text-destructive">{seg.text}</p>
      </div>
    );
  }

  if (seg.kind === "verify" || seg.kind === "reflect") {
    const isVerify = seg.kind === "verify";
    return (
      <div key={seg.id} className="trace-seg">
        <span className="trace-tag flex items-center gap-1 text-muted-foreground">
          {isVerify ? "验证" : "反思"}
        </span>
        <p className="text-sm whitespace-pre-wrap break-words text-muted-foreground">{seg.text}</p>
      </div>
    );
  }

  return null;
}