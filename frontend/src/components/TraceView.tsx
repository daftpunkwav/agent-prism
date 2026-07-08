import { useEffect, useState } from "react";
import { ArenaEvent } from "@/lib/api";

const TICK_MS = 24; // 打字机帧间隔
// 自适应速度：文字越长每帧吐越多字符，总时长封顶约 1.4s
function charsPerTick(len: number): number {
  return Math.max(1, Math.ceil(len / 60));
}

function isThought(ev: ArenaEvent): boolean {
  return ev.type === "thought" && ev.step !== 0;
}

/**
 * 缓冲队列播放：
 * - 运行中扣住最后收到的一步（releasable = 收到数 - 1），等下一步到了再释放，
 *   让打字机播第 N 步的耗时掩盖第 N+1 步的生成延迟，做到连续流式。
 * - 顺序播放：一次只播一步，thought 走打字机，其余即时显示。
 * - 运行结束后释放全部剩余。
 */
export function TraceView({ events, running }: { events: ArenaEvent[]; running: boolean }) {
  const segments = events.filter(
    (ev) => ev.type !== "complete" && ev.type !== "token_update"
  );

  const [playIndex, setPlayIndex] = useState(0); // 已完成播放的段数
  const [typed, setTyped] = useState(0); // 当前 thought 已吐出的字符数

  const releasable = running ? Math.max(0, segments.length - 1) : segments.length;

  useEffect(() => {
    if (playIndex >= releasable) return; // 无可播放 / 正扣住最后一步
    const seg = segments[playIndex];
    if (!seg) return;

    // 非推理段（系统提示 / 工具调用 / 结果 / 错误）即时推进
    if (!isThought(seg)) {
      setPlayIndex((i) => i + 1);
      setTyped(0);
      return;
    }

    const text = seg.content ?? "";
    if (typed >= text.length) {
      setPlayIndex((i) => i + 1);
      setTyped(0);
      return;
    }

    const step = charsPerTick(text.length);
    const id = setTimeout(() => {
      setTyped((t) => Math.min(t + step, text.length));
    }, TICK_MS);
    return () => clearTimeout(id);
  }, [segments, releasable, playIndex, typed]);

  return (
    <div className="flex flex-col gap-2 p-3">
      {segments.map((ev, idx) => {
        if (idx > playIndex) return null; // 尚未轮到播放
        const isCurrent = idx === playIndex;
        // 当前段正扣住未释放，不渲染
        if (isCurrent && playIndex >= releasable) return null;

        if (ev.type === "thought" && ev.step === 0) {
          return (
            <div key={idx} className="trace-system">
              {ev.content}
            </div>
          );
        }
        if (ev.type === "thought") {
          const text = ev.content ?? "";
          const shown = isCurrent ? text.slice(0, typed) : text;
          const typing = isCurrent && typed < text.length;
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
      {running && playIndex === 0 && (
        <p className="text-xs text-muted-foreground">连接模型中…</p>
      )}
    </div>
  );
}
