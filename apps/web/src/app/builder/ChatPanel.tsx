/**
 * @file ChatPanel
 * @description Builder conversation panel: history, live turn, and composer.
 *
 * Responsibilities:
 * - Render settled turns as user/assistant bubbles
 * - Render the live turn's segments (reasoning, text, tool calls) while streaming
 * - Own the composer input with send/stop controls
 */

"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  Bot,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Circle,
  FilePenLine,
  Globe,
  Lightbulb,
  Loader2,
  ListTodo,
  MessageCircleQuestion,
  Paperclip,
  ScrollText,
  Search,
  Square,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import type { RunAttachment } from "@agentprism/client";
import { groupPhases, type DisplaySegment, type PhaseCategory, type PhaseGroup } from "@agentprism/arena-view";
import { MarkdownBlock } from "@/components/MarkdownBlock";
import { useT } from "@/i18n/useT";

/**
 * One chat entry: server history carries role/content only; the client attaches
 * the turn's display segments so the bubble keeps its thinking/steps collapsed
 * after the run settles (instead of vanishing with the live view).
 */
export interface ChatEntry {
  role: "user" | "assistant";
  content: string;
  segments?: DisplaySegment[];
}

export interface ChatPanelProps {
  history: ChatEntry[];
  /** False when no session is selected (shows the empty hint). */
  hasSession: boolean;
  /** True while a turn is streaming. */
  running: boolean;
  /** Merged display segments of the in-flight turn (empty when idle). */
  liveSegments: DisplaySegment[];
  onSend: (message: string, attachments: RunAttachment[]) => void;
  onStop: () => void;
}

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 64 * 1024;
const MAX_ATTACHMENT_CHARS = 64 * 1024;
const ACCEPTED_EXTENSIONS =
  ".txt,.md,.markdown,.json,.csv,.log,.py,.js,.ts,.tsx,.jsx,.html,.css,.yaml,.yml,.toml,.ini,.xml,.sql,.sh,.ps1,.java,.c,.cpp,.h,.go,.rs,.rb,.php";

/** One-line detail for a tool call: target path or first command line. */
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

const PHASE_ICONS: Record<PhaseCategory, typeof BrainCircuit> = {
  thinking: BrainCircuit,
  answer: ScrollText,
  read: Search,
  write: FilePenLine,
  code: Terminal,
  plan: ListTodo,
  net: Globe,
  agent: Bot,
  ask: MessageCircleQuestion,
  error: AlertCircle,
  // ChevronRight here would read as a second expander arrow next to the row's
  // own chevron; a neutral dot marks uncategorized work without that ambiguity.
  other: Circle,
};

/** Collapsed-trace body: phases fold consecutive same-kind steps into one row (Arena trace style).
 * With `autoExpandTail` (live turn), the newest phase stays expanded so streaming text remains
 * visible until the user pins an expansion choice of their own. */
export function PhaseGroups({
  segments,
  autoExpandTail = false,
}: {
  segments: DisplaySegment[];
  autoExpandTail?: boolean;
}) {
  const t = useT();
  // null = no pinned choice; "" = user pinned "all collapsed". An unpinned live
  // view falls back to the tail phase so it keeps following the stream.
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const phases = groupPhases(segments);
  const tailId = autoExpandTail && phases.length > 0 ? phases[phases.length - 1]!.id : null;
  const activeOpen = pinnedId !== null ? pinnedId : tailId;
  return (
    <ul className="builder-phase-list">
      {phases.map((phase: PhaseGroup, phaseIndex: number) => {
        const Icon = PHASE_ICONS[phase.category] ?? ChevronRight;
        const open = activeOpen === phase.id;
        const subset = segments.filter((segment) => phase.segmentIds.includes(segment.id));
        const duration =
          phase.durationMs !== null
            ? phase.durationMs < 10_000
              ? `${(phase.durationMs / 1000).toFixed(1)}s`
              : `${Math.round(phase.durationMs / 1000)}s`
            : null;
        return (
          <li key={phase.id} className="builder-phase">
            <button
              type="button"
              className="builder-phase-row"
              aria-expanded={open}
              onClick={() => setPinnedId(open ? "" : phase.id)}
            >
              <ChevronRight
                size={11}
                className={"builder-phase-chevron" + (open ? " is-open" : "")}
                aria-hidden
              />
              <Icon size={12} aria-hidden />
              <span className="builder-phase-label">{t(`builder.phase.${phase.category}` as const)}</span>
              {phase.actor && <span className="builder-phase-actor">{phase.actor}</span>}
              <span className="builder-phase-summary">
                {phase.category === "thinking"
                  ? t("builder.phaseSummary.thinking", { count: phase.thinkingCount })
                  : phase.category === "answer"
                    ? // Only the tail answer phase is the turn's final reply; mid-turn
                      // answer segments are process narration, not the final reply.
                      phaseIndex === phases.length - 1
                      ? t("builder.phaseSummary.answer")
                      : t("builder.phaseSummary.answerMid")
                    : phase.category === "error"
                      ? t("builder.phaseSummary.error")
                      : phase.tools.map((tc) => `${tc.count}× ${tc.tool}`).join(" · ")}
              </span>
              {duration !== null && <span className="builder-phase-duration">{duration}</span>}
            </button>
            {open && <SegmentList segments={subset} running={autoExpandTail} />}
          </li>
        );
      })}
    </ul>
  );
}

/** Pretty-printed call arguments, truncated to keep the DOM bounded. */
function argsPreview(args: Record<string, unknown>): string {
  const json = JSON.stringify(args, null, 2);
  return json.length > 2000 ? json.slice(0, 2000) + "\n...[truncated]" : json;
}

/** One todo item of a todo_write call (status vocabulary of the todo tool). */
interface TodoItem {
  content: string;
  status: string;
}

/** Extracts the todo list from todo_write args; null when the shape is not a todo batch. */
function todoItems(args: Record<string, unknown> | undefined): TodoItem[] | null {
  const raw = (args ?? {})["todos"];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const items = raw.map((item) => {
    const record = item !== null && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return {
      content: typeof record.content === "string" ? record.content : "",
      status: typeof record.status === "string" ? record.status : "pending",
    };
  });
  return items.some((item) => item.content !== "") ? items : null;
}

/** Structured preview of a todo_write call: status icon + content per item. */
function TodoPreview({ items }: { items: TodoItem[] }) {
  const t = useT();
  return (
    <ul className="builder-todo-list">
      {items.map((item, index) => (
        <li key={index} className="builder-todo-item" data-status={item.status}>
          {item.status === "completed" ? (
            <CheckCircle2 size={12} aria-hidden />
          ) : item.status === "in_progress" ? (
            <Loader2 size={12} className="animate-spin" aria-hidden />
          ) : (
            <Circle size={12} aria-hidden />
          )}
          <span>{item.content}</span>
          <span className="builder-todo-status">
            {item.status === "completed"
              ? t("builder.todoDone")
              : item.status === "in_progress"
                ? t("builder.todoActive")
                : t("builder.todoPending")}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Live/rich segment list (also reused by the trace timeline tab). */
export function SegmentList({ segments, running }: { segments: DisplaySegment[]; running: boolean }) {
  const t = useT();
  const liveId = running && segments.length > 0 ? segments[segments.length - 1]!.id : null;
  return (
    <div className="builder-segments">
      {segments.map((segment) => (
        <SegmentRow key={segment.id} segment={segment} live={segment.id === liveId} t={t} />
      ))}
    </div>
  );
}

function SegmentRow({
  segment,
  live,
  t,
}: {
  segment: DisplaySegment;
  live: boolean;
  t: ReturnType<typeof useT>;
}) {
  if (segment.kind === "step") {
    // Settled step markers vanish; only a pending marker at the live tail is shown.
    if (segment.completed || !live) return null;
    return (
      <div className="builder-seg builder-seg-pending">
        <Loader2 size={12} className="animate-spin" aria-hidden />
        <span>{t("builder.stepCalling", { step: segment.step })}</span>
      </div>
    );
  }

  if (segment.kind === "thinking") {
    return (
      <details className="builder-seg builder-seg-thinking">
        <summary className="builder-seg-summary">
          <ChevronRight size={12} aria-hidden />
          <BrainCircuit size={12} aria-hidden />
          <span>{t("builder.thinkingTitle")}</span>
          {live ? (
            <span className="builder-seg-live-hint">{t("builder.thinkingStreaming")}</span>
          ) : (
            <span className="builder-seg-meta">{t("builder.thinkingChars", { count: segment.text.length })}</span>
          )}
        </summary>
        <pre className="builder-seg-pre builder-seg-pre-thinking">{segment.text}</pre>
      </details>
    );
  }

  if (segment.kind === "thought") {
    if (segment.meta) {
      return (
        <details className="builder-seg builder-seg-banner">
          <summary className="builder-seg-summary">
            <ChevronRight size={12} aria-hidden />
            <Lightbulb size={12} aria-hidden />
            <span>{t("builder.bannerTitle")}</span>
          </summary>
          <pre className="builder-seg-pre builder-seg-pre-banner">{segment.text}</pre>
        </details>
      );
    }
    const streaming = !segment.completed;
    return (
      <div className="builder-seg builder-seg-thought">
        <div className="builder-seg-tag">
          <Lightbulb size={12} aria-hidden />
          {t("builder.reasoningTitle", { step: segment.step })}
          {streaming && <span className="builder-seg-live-hint">{t("builder.thinkingStreaming")}</span>}
        </div>
        <div className="builder-seg-prose">
          {streaming ? (
            <span className="whitespace-pre-wrap break-words">
              {segment.text}
              <span className="builder-seg-cursor" />
            </span>
          ) : (
            <MarkdownBlock text={segment.text} />
          )}
        </div>
      </div>
    );
  }

  if (segment.kind === "action") {
    const todos = segment.tool === "todo_write" ? todoItems(segment.args) : null;
    const todoProgress = todos !== null ? todos.filter((item) => item.status === "completed").length : 0;
    const detail =
      todos !== null
        ? t("builder.todoProgress", { done: todoProgress, total: todos.length })
        : actionDetail(segment);
    const result = segment.result ?? "";
    const diff = segment.diff ?? "";
    const executing = live && segment.resultDone === false;
    return (
      <details className="builder-seg builder-seg-action">
        <summary className="builder-seg-summary">
          <ChevronRight size={12} aria-hidden />
          <Zap size={12} aria-hidden />
          <span className="builder-seg-tool">{segment.tool || "unknown"}</span>
          {detail !== "" && <span className="builder-seg-detail">{detail}</span>}
          {executing ? (
            <span className="builder-seg-live-hint inline-flex items-center gap-1">
              <Loader2 size={11} className="animate-spin" aria-hidden />
              {t("builder.actionRunning")}
            </span>
          ) : (
            result !== "" && <span className="builder-seg-done">{t("builder.actionDone")}</span>
          )}
        </summary>
        <div className="builder-seg-body">
          {todos !== null ? (
            <div>
              <p className="builder-seg-body-label">{t("builder.todoList")}</p>
              <TodoPreview items={todos} />
            </div>
          ) : (
            <div>
              <p className="builder-seg-body-label">{t("builder.callArgs")}</p>
              <pre className="builder-seg-pre">{argsPreview(segment.args ?? {})}</pre>
            </div>
          )}
          {result !== "" && (
            <div>
              <p className="builder-seg-body-label">{t("builder.callResult")}</p>
              <div className="builder-seg-prose">
                <MarkdownBlock text={result} />
              </div>
            </div>
          )}
          {diff !== "" && (
            <div>
              <p className="builder-seg-body-label">{t("builder.fileDiff")}</p>
              <pre className="builder-seg-pre">{diff.length > 2000 ? diff.slice(0, 2000) + "\n...[truncated]" : diff}</pre>
            </div>
          )}
        </div>
      </details>
    );
  }

  if (segment.kind === "observation") {
    const result = segment.text || "";
    return (
      <div className="builder-seg builder-seg-observation">
        <div className="builder-seg-tag">
          <Terminal size={12} aria-hidden />
          {t("builder.result")}
        </div>
        <div className="builder-seg-prose">
          <MarkdownBlock text={result} />
        </div>
      </div>
    );
  }

  if (segment.kind === "tool_progress") {
    return (
      <div className="builder-seg builder-seg-observation">
        <div className="builder-seg-tag">
          <Terminal size={12} aria-hidden />
          {t("builder.toolProgress")}
          {!segment.completed && <span className="builder-seg-live-hint">{t("builder.streaming")}</span>}
        </div>
        <pre className="builder-seg-pre">{segment.text}</pre>
      </div>
    );
  }

  if (segment.kind === "file_diff") {
    return (
      <div className="builder-seg builder-seg-action">
        <div className="builder-seg-tag">
          <Zap size={12} aria-hidden />
          {t("builder.fileDiff")}
        </div>
        <pre className="builder-seg-pre">{segment.text}</pre>
      </div>
    );
  }

  if (segment.kind === "error") {
    return (
      <div className="builder-seg builder-seg-error">
        <div className="builder-seg-tag">
          <Square size={12} aria-hidden />
          {t("builder.error")}
        </div>
        <p className="whitespace-pre-wrap break-words text-destructive">{segment.text}</p>
      </div>
    );
  }

  if (segment.kind === "verify" || segment.kind === "reflect" || segment.kind === "harness_edit") {
    const label =
      segment.kind === "verify"
        ? t("builder.verify")
        : segment.kind === "reflect"
          ? // Multi-agent flows announce speaker turns, dispatches, and critiques
            // over reflect — the actor's name is the honest label there.
            (segment.actor ?? t("builder.reflect"))
          : t("builder.harnessEdit");
    return (
      <div className="builder-seg builder-seg-meta">
        <div className="builder-seg-tag">{label}</div>
        <p className="whitespace-pre-wrap break-words">{segment.text}</p>
      </div>
    );
  }

  return null;
}

/**
 * Builder conversation panel: settled bubbles, live turn segments, and composer.
 *
 * @param history Settled user/assistant turns.
 * @param hasSession False shows the empty hint instead of the composer.
 * @param running Live trace rendering plus stop control while streaming.
 * @param liveSegments Merged display segments of the in-flight turn.
 * @param onSend Sends the draft with staged attachments, then clears both.
 * @param onStop Aborts the in-flight turn.
 */
export function ChatPanel({ history, hasSession, running, liveSegments, onSend, onStop }: ChatPanelProps) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<RunAttachment[]>([]);
  const attachmentsRef = useRef<RunAttachment[]>([]);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Auto-follow owns the scroll position only while the user sits at the bottom;
  // scrolling up hands control to the user until they return to the tail.
  const followRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  // Streamed text grows the last segment without changing segment counts, so the
  // scroll signature must include the live text length, not just list lengths.
  const liveTextLength = liveSegments.reduce((sum, segment) => sum + segment.text.length, 0);
  useEffect(() => {
    const node = scrollRef.current;
    if (node !== null && followRef.current) node.scrollTop = node.scrollHeight;
  }, [history.length, liveSegments.length, liveTextLength, running]);

  const handleScroll = () => {
    const node = scrollRef.current;
    if (node === null) return;
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
    followRef.current = atBottom;
    setShowJump(!atBottom);
  };

  const jumpToBottom = () => {
    const node = scrollRef.current;
    if (node === null) return;
    followRef.current = true;
    setShowJump(false);
    node.scrollTop = node.scrollHeight;
  };

  const submit = () => {
    const message = draft.trim();
    if (message === "" || running) return;
    onSend(message, attachments);
    setDraft("");
    setAttachments([]);
    setAttachError(null);
  };

  const handleAttachFiles = async (files: File[]) => {
    setAttachError(null);
    for (const file of files) {
      if (attachmentsRef.current.length >= MAX_ATTACHMENTS) {
        setAttachError(t("builder.attach.tooMany"));
        break;
      }
      if (attachmentsRef.current.some((a) => a.name === file.name)) continue;
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setAttachError(t("builder.attach.tooLarge", { name: file.name }));
        continue;
      }
      try {
        const content = (await file.text()).slice(0, MAX_ATTACHMENT_CHARS);
        if (attachmentsRef.current.some((a) => a.name === file.name) || attachmentsRef.current.length >= MAX_ATTACHMENTS) {
          continue;
        }
        const next = [...attachmentsRef.current, { name: file.name, content }];
        attachmentsRef.current = next;
        setAttachments(next);
      } catch (error) {
        console.warn(`[builder] Attachment read failed: ${file.name}`, error);
      }
    }
  };

  return (
    <div className="builder-chat">
      <div className="builder-chat-scroll" ref={scrollRef} onScroll={handleScroll}>
        {!hasSession ? (
          <div className="builder-chat-empty">{t("builder.noSession")}</div>
        ) : (
          // margin-top:auto pins short content to the bottom; when content exceeds
          // the container the margin collapses to 0 and normal overflow scrolling
          // applies (justify-content:flex-end on a scroller breaks scrollHeight in Chrome).
          <div className="builder-chat-content">
            {history.map((message, index) =>
              message.role === "assistant" ? (
                // Agent output is flat, never a bubble: the work trail sits above
                // the final answer, collapsed after the reply lands (it streams
                // expanded in the live view while the turn runs).
                <div key={index} className="builder-turn">
                  {message.segments && message.segments.length > 0 && (
                    <details className="builder-turn-trace">
                      <summary className="builder-turn-trace-summary">
                        <ChevronRight size={12} aria-hidden />
                        {t("builder.turnTrace")}
                        <span className="builder-turn-trace-count">
                          {groupPhases(message.segments).length}
                        </span>
                      </summary>
                      <PhaseGroups segments={message.segments} />
                    </details>
                  )}
                  <div className="builder-answer">
                    <MarkdownBlock text={message.content} />
                  </div>
                </div>
              ) : (
                <div key={index} className="builder-msg" data-role="user">
                  {message.content}
                </div>
              ),
            )}
            {running ? (
              <div className="builder-live">
                <div className="builder-live-head">
                  <span className="eyebrow">{t("builder.liveTrace")}</span>
                  <button type="button" className="chip-toggle" onClick={onStop}>
                    <Square size={11} /> {t("builder.stop")}
                  </button>
                </div>
                {/* Live view follows the Arena trace: phase rows all the way through,
                    with the newest phase auto-expanded so streaming text stays visible. */}
                <PhaseGroups segments={liveSegments} autoExpandTail />
              </div>
            ) : null}
          </div>
        )}
      </div>
      {showJump ? (
        <button type="button" className="builder-jump-bottom" onClick={jumpToBottom}>
          <ArrowDown size={12} aria-hidden />
          {t("builder.jumpBottom")}
        </button>
      ) : null}
      {attachments.length > 0 ? (
        <div className="composer-attachments">
          {attachments.map((attachment) => (
            <span key={attachment.name} className="composer-attachment-chip">
              <span className="composer-attachment-name">{attachment.name}</span>
              <button
                type="button"
                className="composer-attachment-remove"
                aria-label={t("builder.attach.removeAria", { name: attachment.name })}
                onClick={() => {
                  const next = attachmentsRef.current.filter((a) => a.name !== attachment.name);
                  attachmentsRef.current = next;
                  setAttachments(next);
                }}
              >
                <X className="h-2.5 w-2.5" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {attachError !== null ? <p className="composer-error">{attachError}</p> : null}
      <div className="composer-input-wrap">
        <button
          type="button"
          className="btn-ghost !h-8 !w-8 !p-0 shrink-0"
          title={t("builder.attach.add")}
          aria-label={t("builder.attach.add")}
          disabled={running}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="h-3.5 w-3.5" aria-hidden />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          accept={ACCEPTED_EXTENSIONS}
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            void handleAttachFiles(files);
          }}
        />
        <textarea
          className="form-input builder-composer"
          rows={2}
          value={draft}
          placeholder={t("builder.chatPlaceholder")}
          disabled={running}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button type="button" className="btn-primary" disabled={running || draft.trim() === ""} onClick={submit}>
          {t("builder.send")}
        </button>
      </div>
    </div>
  );
}
