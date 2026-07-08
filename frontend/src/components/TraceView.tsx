"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { ArenaEvent } from "@/lib/api";

const TICK_MS = 24;

function charsPerTick(len: number): number {
  return Math.max(1, Math.ceil(len / 60));
}

function isThought(ev: ArenaEvent): boolean {
  return ev.type === "thought" && ev.step !== 0;
}

/**
 * 缓冲队列播放 Trace：
 * - playIndex / typed 存在 ref 中，避免触发重渲染导致动画重置
 * - 运行中扣住最后一步（releasable = 收到数 - 1）
 * - 用 requestAnimationFrame 驱动，不依赖 React 重渲染节拍
 */
export function TraceView({ events, running }: { events: ArenaEvent[]; running: boolean }) {
  // 排除不需要显示的段
  const segments = events.filter(
    (ev) => ev.type !== "complete" && ev.type !== "token_update"
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const playIndexRef = useRef(0);   // 当前正在播放的段索引
  const typedRef = useRef(0);        // 当前 thought 已吐出的字符数
  const tickRef = useRef<number>(0); // requestAnimationFrame id
  const segmentsRef = useRef(segments);
  const runningRef = useRef(running);

  // 保持 ref 与 props 同步
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

    // 无可播放 / 扣住最后一步
    if (idx >= rel) {
      tickRef.current = requestAnimationFrame(tick);
      return;
    }

    const seg = segs[idx];
    if (!seg) {
      tickRef.current = requestAnimationFrame(tick);
      return;
    }

    // 非 thought 段即时推进
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
    // 触发一次重渲染以显示最新 typed 值
    forceUpdate();
    tickRef.current = requestAnimationFrame(tick);
  }, []);

  // 用一个微型 state 强制 React 重渲染（仅用于打字机可视化）
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    tickRef.current = requestAnimationFrame(tick);
    return () => {
      if (tickRef.current) cancelAnimationFrame(tickRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  // 渲染：segments 全部当前可用的段，playIndex 决定可见范围
  const visibleCount = running
    ? Math.max(0, segments.length - 1)
    : segments.length;

  return (
    <div ref={containerRef} className="flex flex-col gap-2 p-3">
      {segments.map((ev, idx) => {
        if (idx > visibleCount) return null;
        const isCurrent = idx === playIndexRef.current;
        // 当前段正扣住未释放，不渲染
        if (isCurrent && playIndexRef.current >= releasable && running) return null;

        if (ev.type === "thought" && ev.step === 0) {
          return (
            <div key={idx} className="trace-system">
              {ev.content}
            </div>
          );
        }
        if (ev.type === "thought") {
          const text = ev.content ?? "";
          const showCount = isCurrent ? typedRef.current : text.length;
          const shown = text.slice(0, showCount);
          const typing = isCurrent && typedRef.current < text.length;
          return (
            <div key={idx} className="trace-seg trace-thought">
              <span className="trace-tag">推理</span>
              <p className="whitespace-pre-wrap break-words">
                {shown}
                {typing && <span className="trace-cursor" />}
              </p>
            </div>
          );
        }
        if (ev.type === "action") {
          const args = ev.args ?? {};
          const argStr = Object.keys(args).length ? JSON.stringify(args) : "";
          return (
            <div key={idx} className="trace-seg trace-action">
              <span className="trace-tag">调用工具</span>
              <p className="font-mono text-xs break-all">
                {ev.tool}
                {argStr && <span className="text-muted-foreground">({argStr})</span>}
              </p>
            </div>
          );
        }
        if (ev.type === "observation") {
          return (
            <div key={idx} className="trace-seg trace-observation">
              <span className="trace-tag">结果</span>
              <p className="whitespace-pre-wrap break-words text-muted-foreground">{ev.result}</p>
            </div>
          );
        }
        if (ev.type === "error") {
          return (
            <div key={idx} className="trace-seg trace-error">
              <span className="trace-tag">错误</span>
              <p className="whitespace-pre-wrap break-words text-destructive">{ev.message}</p>
            </div>
          );
        }
        return null;
      })}
      {running && playIndexRef.current === 0 && segments.length === 0 && (
        <p className="text-xs text-muted-foreground">连接模型中…</p>
      )}
    </div>
  );
}
