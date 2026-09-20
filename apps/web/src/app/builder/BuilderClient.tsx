/**
 * @file BuilderClient
 * @description The Agent Builder shell: block board, chat, and observability.
 *
 * Responsibilities:
 * - Load the block catalog and session registry
 * - Own the active session's draft composition and hot-swap application
 * - Stream chat turns, routing chunks into chat / trace / event state
 *
 * The three columns share this state hub; every child stays presentation-only.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Bot, Check, Pencil, Plus, Square, Trash2, X } from "lucide-react";
import {
  abortBuilderTurn,
  answerBuilderQuestion,
  createBuilderSession,
  deleteBuilderSession,
  fetchBuilderCatalog,
  fetchBuilderSessionDetail,
  fetchBuilderSessions,
  patchBuilderComposition,
  streamBuilderChat,
  type ArenaEvent,
  type BuilderCatalog,
  type BuilderComposition,
  type BuilderSessionView,
  type BuilderTraceEntry,
  type BuilderTraceRecord,
  type RunAttachment,
} from "@agentprism/client";
import { useT } from "@/i18n/useT";
import { AskUserModal, askQuestionsOfArgs, type PendingAskBatch } from "@/components/AskUserModal";
import { attachTurnSegments, mergedTraceEntries, segmentsOf, settledTurns } from "./builderTrace";
import { BlockBoard } from "./BlockBoard";
import { ChatPanel, type ChatEntry } from "./ChatPanel";
import { TracePanel, type TraceTab } from "./TracePanel";

/** Persisted three-column layout: side widths plus left/right collapse. */
interface BuilderLayout {
  leftW: number;
  rightW: number;
  leftOpen: boolean;
  rightOpen: boolean;
}

const LAYOUT_KEY = "agentprism.builder.layout";
const DEFAULT_LAYOUT: BuilderLayout = { leftW: 320, rightW: 420, leftOpen: true, rightOpen: true };

/** Side-width bounds as fractions of the shell's column area: two visible
 * columns allow [1/3, 2/3] per side, three visible columns [1/4, 1/2]. */
const TWO_COL_BOUNDS = { minFrac: 1 / 3, maxFrac: 2 / 3 };
const THREE_COL_BOUNDS = { minFrac: 0.25, maxFrac: 0.5 };

/** Pointer travel (px) past which a press becomes a drag instead of a click. */
const DRAG_THRESHOLD_PX = 4;

/** Live width of the area the three columns share (shell content minus the
 * two grid gaps); 0 when unavailable (SSR prerender, unmounted mid-gesture). */
function shellColumnWidth(): number {
  if (typeof document === "undefined") return 0;
  const shell = document.querySelector(".builder-shell");
  if (!(shell instanceof HTMLElement)) return 0;
  const style = getComputedStyle(shell);
  const gap = Number.parseFloat(style.columnGap);
  const width =
    shell.clientWidth -
    Number.parseFloat(style.paddingLeft) -
    Number.parseFloat(style.paddingRight) -
    (Number.isFinite(gap) ? gap * 2 : 0);
  return Number.isFinite(width) && width > 0 ? width : 0;
}

/**
 * Clamp one side column to the active bounds. With three columns the chat
 * column also keeps its minimum share, so this side is additionally capped by
 * the other side's width; the cap never drops below the minimum.
 */
function clampSideW(width: number, otherW: number, threeCols: boolean, total: number): number {
  if (!Number.isFinite(width) || total <= 0) return width;
  const { minFrac, maxFrac } = threeCols ? THREE_COL_BOUNDS : TWO_COL_BOUNDS;
  let hi = maxFrac * total;
  if (threeCols) hi = Math.max(minFrac * total, Math.min(hi, (1 - minFrac) * total - otherW));
  return Math.round(Math.min(hi, Math.max(minFrac * total, width)));
}

/** Clamp open side widths to the bounds of the given visibility; idempotent. */
function clampLayout(prev: BuilderLayout): BuilderLayout {
  const total = shellColumnWidth();
  if (total <= 0) return prev;
  const threeCols = prev.leftOpen && prev.rightOpen;
  const leftW = prev.leftOpen ? clampSideW(prev.leftW, prev.rightW, threeCols, total) : prev.leftW;
  const rightW = prev.rightOpen ? clampSideW(prev.rightW, leftW, threeCols, total) : prev.rightW;
  if (leftW === prev.leftW && rightW === prev.rightW) return prev;
  return { ...prev, leftW, rightW };
}

function loadLayout(): BuilderLayout {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(LAYOUT_KEY) : null;
    if (!raw) return clampLayout(DEFAULT_LAYOUT);
    const parsed = JSON.parse(raw) as Partial<BuilderLayout>;
    return clampLayout({
      leftW: typeof parsed.leftW === "number" && Number.isFinite(parsed.leftW) ? parsed.leftW : DEFAULT_LAYOUT.leftW,
      rightW: typeof parsed.rightW === "number" && Number.isFinite(parsed.rightW) ? parsed.rightW : DEFAULT_LAYOUT.rightW,
      leftOpen: parsed.leftOpen ?? true,
      rightOpen: parsed.rightOpen ?? true,
    });
  } catch {
    return DEFAULT_LAYOUT;
  }
}

/** Builder workspace root: sessions, composition, chat turns, and trace panels. */
export function BuilderClient() {
  const t = useT();
  const [catalog, setCatalog] = useState<BuilderCatalog | null>(null);
  const [sessions, setSessions] = useState<BuilderSessionView[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [composition, setComposition] = useState<BuilderComposition | null>(null);
  const [history, setHistory] = useState<ChatEntry[]>([]);
  /** Persisted observability journal of the active session (trace + events + turn markers). */
  const [records, setRecords] = useState<BuilderTraceRecord[]>([]);
  /** Live trace entries of the in-flight turn (SSE; the journal gets them too). */
  const [trace, setTrace] = useState<BuilderTraceEntry[]>([]);
  const [events, setEvents] = useState<ArenaEvent[]>([]);
  /** Mirrors events for turn-end snapshots (state is stale inside stream callbacks). */
  const eventsRef = useRef<ArenaEvent[]>([]);
  /** Active session workspace for the workspace tab (null before the first turn). */
  const [workspace, setWorkspace] = useState<string | null>(null);
  /** Bumped on file_diff events for instant workspace refresh. */
  const [wsRefresh, setWsRefresh] = useState(0);
  const [running, setRunning] = useState(false);
  const [layout, setLayout] = useState<BuilderLayout>(DEFAULT_LAYOUT);
  const layoutLoadedRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TraceTab>("timeline");
  // Live ask_user batch (popped from ask_user action events, cleared on observation/turn end).
  const [pendingAsk, setPendingAsk] = useState<PendingAskBatch | null>(null);
  const [askSubmitting, setAskSubmitting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Mirrors activeId for in-flight stream callbacks: chunks arriving after a
  // session switch must not leak into the newly selected session's view.
  const activeIdRef = useRef<string | null>(null);
  /** Teardown of an in-flight pointer gesture; runs on unmount if still set. */
  const teardownRef = useRef<(() => void) | null>(null);

  const switchSession = useCallback(
    (id: string | null) => {
      activeIdRef.current = id;
      setActiveId(id);
    },
    [],
  );

  const refreshSessions = useCallback(async (): Promise<BuilderSessionView[]> => {
    const list = await fetchBuilderSessions();
    setSessions(list);
    return list;
  }, []);

  useEffect(() => {
    void fetchBuilderCatalog()
      .then(setCatalog)
      .catch(() => setCatalog(null));
    void refreshSessions()
      .then((list) => {
        if (list.length > 0) switchSession(list[0]?.id ?? null);
      })
      .catch(() => setSessions([]));
  }, [refreshSessions, switchSession]);

  // Load persisted side widths/collapse after mount (never during render: the
  // server prerender must match the first client render to avoid hydration drift).
  useEffect(() => {
    if (layoutLoadedRef.current) {
      try {
        window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
      } catch {
        // Private mode / quota: layout simply resets next visit.
      }
      return;
    }
    layoutLoadedRef.current = true;
    setLayout(loadLayout());
  }, [layout]);

  // A width valid at one window size can breach the fraction bounds at another;
  // re-clamp open side widths whenever the viewport changes.
  useEffect(() => {
    const onViewportResize = () => setLayout(clampLayout);
    window.addEventListener("resize", onViewportResize);
    return () => window.removeEventListener("resize", onViewportResize);
  }, []);

  // A pointer gesture outlives renders: if the shell unmounts mid-press its
  // window listeners must go with it.
  useEffect(() => () => teardownRef.current?.(), []);

  // Load the active session's composition, history, and persisted execution trail.
  useEffect(() => {
    if (activeId === null) {
      setComposition(null);
      setHistory([]);
      setRecords([]);
      setTrace([]);
      setEvents([]);
      eventsRef.current = [];
      setWorkspace(null);
      return;
    }
    void fetchBuilderSessionDetail(activeId)
      .then((detail) => {
        setComposition(detail.session.composition);
        setHistory(attachTurnSegments(detail.session.history, detail.records));
        setRecords(detail.records);
        setTrace([]);
        setEvents([]);
        eventsRef.current = [];
        setWorkspace(detail.session.workspace || null);
        setDirty(false);
      })
      .catch(() => {
        switchSession(null);
      });
  }, [activeId, switchSession]);

  const handleCreateSession = useCallback(async () => {
    if (catalog === null) return;
    try {
      const view = await createBuilderSession({ name: "", composition: {} });
      await refreshSessions();
      switchSession(view.id);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [catalog, refreshSessions, switchSession]);

  const handleDeleteSession = useCallback(
    async (id: string) => {
      try {
        await deleteBuilderSession(id);
        const list = await refreshSessions();
        if (activeIdRef.current === id) {
          switchSession(list[0]?.id ?? null);
        }
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refreshSessions, switchSession],
  );

  const handleApplySwap = useCallback(async () => {
    if (activeId === null || composition === null) return;
    try {
      const result = await patchBuilderComposition(activeId, { composition });
      setComposition(result.composition);
      setDirty(false);
      // The server journals a swap entry; pull it in so the timeline shows the
      // hot-swap banner without a full page refetch.
      const detail = await fetchBuilderSessionDetail(activeId);
      setRecords(detail.records);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [activeId, composition]);

  const handleRename = async (id: string, name: string): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed === "") {
      setRenamingId(null);
      return;
    }
    try {
      await patchBuilderComposition(id, { name: trimmed });
      setSessions((list) => list.map((s) => (s.id === id ? { ...s, name: trimmed } : s)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setRenamingId(null);
  };

  const sessionName = sessions.find((session) => session.id === activeId)?.name ?? "Agent";

  const handleSend = useCallback(
    (message: string, attachments: RunAttachment[]) => {
      if (activeId === null || composition === null) return;
      const sessionId = activeId;
      const controller = new AbortController();
      let answerReceived = false;
      const isCompactCommand = message.trim() === "/compact";
      abortRef.current = controller;
      setRunning(true);
      setEvents([]);
      eventsRef.current = [];
      setPendingAsk(null);
      setHistory((prev) => [...prev, { role: "user", content: message }]);
      // Mark the session running in the registry immediately, so the session list's
      // guards (switch/delete) reflect the turn while it streams.
      void refreshSessions();

      void streamBuilderChat({
        sessionId,
        message,
        attachments: attachments.length > 0 ? attachments : undefined,
        signal: controller.signal,
        onChunk: (chunk) => {
          // A turn is bound to the session it started on: chunks arriving after a
          // switch (if any slipped through) must not corrupt the current view.
          if (activeIdRef.current !== sessionId) return;
          if (chunk.stream === "trace") {
            setTrace((prev) => [...prev, chunk.entry]);
          } else if (chunk.stream === "event") {
            setEvents((prev) => [...prev, chunk.event]);
            eventsRef.current = [...eventsRef.current, chunk.event];
            // The stream knows the workspace name before the turn ends: adopt it
            // the moment any event carries it so the workspace tab goes live.
            if (chunk.event.workspace) setWorkspace(chunk.event.workspace);
            // Mutating tool outcomes refresh the workspace instantly (file diffs
            // directly; any observation covers run-style mutations like mkdir).
            if (chunk.event.type === "file_diff" || chunk.event.type === "observation") {
              setWsRefresh((n) => n + 1);
            }
            // ask_user pops the question modal; the following observation (answer
            // delivered, skipped, or channel timeout) closes it. Case-insensitive:
            // a model-cased tool name must still pop the window (arena parity),
            // otherwise the run waits with no UI and reads as "not responding".
            if (chunk.event.type === "action" && chunk.event.tool?.toLowerCase() === "ask_user") {
              const questions = askQuestionsOfArgs(chunk.event.args);
              if (questions.length > 0) setPendingAsk({ sourceLabel: sessionName, questions });
            } else if (chunk.event.type === "observation") {
              setPendingAsk(null);
            }
          } else if (chunk.stream === "turn") {
            // Aborted / failed turns arrive with an empty answer and are not appended.
            setPendingAsk(null);
            if (chunk.turn.workspace) setWorkspace(chunk.turn.workspace);
            if (chunk.turn.answer !== "") {
              answerReceived = true;
              if (isCompactCommand) {
                void fetchBuilderSessionDetail(sessionId)
                  .then((detail) => {
                    if (activeIdRef.current === sessionId) {
                      setHistory(attachTurnSegments(detail.session.history, detail.records));
                      setRecords(detail.records);
                    }
                  })
                  .catch(() => undefined);
              } else {
                // Snapshot this turn's segments onto the bubble: the live view
                // unmounts when the run settles, the collapsed trail must not.
                const snapshot = segmentsOf(eventsRef.current);
                setHistory((prev) => [
                  ...prev,
                  { role: "assistant", content: chunk.turn.answer, segments: snapshot },
                ]);
              }
            }
          } else if (chunk.stream === "error") {
            // In-stream failures previously fell through all branches: failed turns showed nothing.
            if (activeIdRef.current === sessionId) {
              setError(t("builder.turnFailed", { message: chunk.message }));
            }
          }
        },
      })
        .catch((err: unknown) => {
          // Network/HTTP failures reject the stream; user aborts end silently by contract.
          if (controller.signal.aborted) return;
          // The client lost the stream but the server turn is still alive (it would
          // keep the session locked for its whole wait window — e.g. an ask_user
          // deadline — and 409 the next send). Abort it so both sides converge.
          void abortBuilderTurn(sessionId).catch(() => undefined);
          if (activeIdRef.current === sessionId) {
            setError(t("builder.turnFailed", { message: err instanceof Error ? err.message : String(err) }));
          }
        })
        .finally(async () => {
          // A superseded stream's teardown must not flip a newer run's state.
          if (abortRef.current === controller) {
            setRunning(false);
            abortRef.current = null;
            setPendingAsk(null);
          }
          void refreshSessions();
          // The settled turn is in the journal now: pull it so the timeline keeps
          // the whole trail, then drop the live tail (it would duplicate the block).
          try {
            const detail = await fetchBuilderSessionDetail(sessionId);
            if (activeIdRef.current === sessionId) {
              setRecords(detail.records);
              setTrace([]);
              setEvents([]);
              eventsRef.current = [];
              // Re-sync state the snapshot path does not cover (aborted/failed turns,
              // /compact, workspace handoff) without clobbering the fresh bubble.
              if (!answerReceived || isCompactCommand) {
                setHistory(attachTurnSegments(detail.session.history, detail.records));
              }
              if (detail.session.workspace) setWorkspace(detail.session.workspace);
            }
          } catch {
            // Detail refetch failed: the live tail stays as the fallback view.
          }
        });
    },
    [activeId, composition, refreshSessions, sessionName, t],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    if (activeId !== null) void abortBuilderTurn(activeId).catch(() => undefined);
    setPendingAsk(null);
  }, [activeId]);

  /** Aborts any session's server-side turn (session-row stop) and re-syncs the list.
   * Covers turns this client lost the stream for (reload, other tab, dropped SSE):
   * without it a stuck turn would 409 every later send until its wait deadline. */
  const handleAbortSession = useCallback(
    (id: string) => {
      if (activeIdRef.current === id) abortRef.current?.abort();
      void abortBuilderTurn(id)
        .catch(() => undefined)
        .finally(() => void refreshSessions());
    },
    [refreshSessions],
  );

  const handleAskAnswer = useCallback(
    async (questionId: string, answer: string): Promise<boolean> => {
      if (activeId === null) return false;
      setAskSubmitting(true);
      try {
        await answerBuilderQuestion(activeId, questionId, answer);
        return true;
      } catch {
        setError(t("common.askSubmitError"));
        return false;
      } finally {
        setAskSubmitting(false);
      }
    },
    [activeId, t],
  );

  const liveSegments = useMemo(() => segmentsOf(events), [events]);
  // Session-wide view data: journal records merged with the live SSE stream.
  const allTrace = useMemo(() => mergedTraceEntries(records, trace), [records, trace]);
  const turnGroups = useMemo(() => settledTurns(records), [records]);

  // Server-side running flag of the active session: guards against 409s when this
  // view's local stream state has diverged (reload, another tab, dropped SSE).
  const activeSessionRunning = sessions.find((session) => session.id === activeId)?.running ?? false;
  const chatBusy = running || activeSessionRunning;

  /** Collapse/expand one side column; open widths re-clamp to the new count. */
  const toggleSide = useCallback((side: "left" | "right") => {
    setLayout((prev) =>
      clampLayout(side === "left" ? { ...prev, leftOpen: !prev.leftOpen } : { ...prev, rightOpen: !prev.rightOpen }),
    );
  }, []);

  /** Press-and-release on a handle or edge line toggles that column; a press
   * that travels drags — resizing an open column, or pulling a collapsed one
   * open at the dragged width. Teardown covers pointercancel and unmount. */
  const startGesture = useCallback(
    (side: "left" | "right") => (event: React.PointerEvent<HTMLDivElement>) => {
      // Only the primary pointer with the primary button starts a gesture:
      // right/middle clicks and extra touch fingers must be ignored.
      if (event.button !== 0 || !event.isPrimary) return;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      const openAtPress = side === "left" ? layout.leftOpen : layout.rightOpen;
      const startW = side === "left" ? layout.leftW : layout.rightW;
      const otherW = side === "left" ? layout.rightW : layout.leftW;
      // Column count during the drag: the dragged side is open by then.
      const threeCols = side === "left" ? layout.rightOpen : layout.leftOpen;
      const handle = event.currentTarget;
      let dragging = false;
      try {
        // Capture keeps move/up delivery alive when the pointer leaves the window.
        handle.setPointerCapture(pointerId);
      } catch {
        // Capture can fail on a detached node; window listeners still cover it.
      }
      const onMove = (move: PointerEvent) => {
        if (move.pointerId !== pointerId) return;
        const dx = move.clientX - startX;
        const dy = move.clientY - startY;
        if (!dragging) {
          // Jitter within the threshold stays a candidate click; past it the
          // gesture is a drag and can no longer toggle the column.
          if (Math.abs(dx) <= DRAG_THRESHOLD_PX && Math.abs(dy) <= DRAG_THRESHOLD_PX) return;
          dragging = true;
        }
        const inward = side === "left" ? dx : -dx;
        const raw = openAtPress ? startW + inward : inward;
        const next = clampSideW(raw, otherW, threeCols, shellColumnWidth());
        setLayout((prev) => {
          if (side === "left") {
            return prev.leftOpen && prev.leftW === next ? prev : { ...prev, leftOpen: true, leftW: next };
          }
          return prev.rightOpen && prev.rightW === next ? prev : { ...prev, rightOpen: true, rightW: next };
        });
      };
      const onUp = (up: PointerEvent) => {
        if (up.pointerId !== pointerId) return;
        teardown();
        // A clean press-and-release (no drag) is the collapse/expand toggle.
        if (!dragging) toggleSide(side);
      };
      const onCancel = (cancel: PointerEvent) => {
        if (cancel.pointerId !== pointerId) return;
        // Interrupted gestures (palm rejection, alt-tab, stylus) settle silently.
        teardown();
      };
      const teardown = () => {
        teardownRef.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        try {
          handle.releasePointerCapture(pointerId);
        } catch {
          // Already released on up/cancel, or the node is gone; nothing to do.
        }
      };
      teardownRef.current = teardown;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    },
    [layout, toggleSide],
  );

  /** Keyboard resize step (px per ArrowLeft/ArrowRight press). */
  const RESIZE_STEP = 16;

  /** Arrow keys resize; Enter/Space toggles the column (pointer parity). */
  const resizeByKeyboard = useCallback(
    (side: "left" | "right") => (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleSide(side);
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const delta = event.key === "ArrowLeft" ? -RESIZE_STEP : RESIZE_STEP;
      setLayout((prev) => {
        // A collapsed column has no visible width to nudge; arrows stay inert.
        if (side === "left" ? !prev.leftOpen : !prev.rightOpen) return prev;
        const threeCols = prev.leftOpen && prev.rightOpen;
        if (side === "left") {
          const next = clampSideW(prev.leftW + delta, prev.rightW, threeCols, shellColumnWidth());
          return prev.leftW === next ? prev : { ...prev, leftW: next };
        }
        // Right handle mirrors the pointer drag: ArrowRight narrows the column.
        const next = clampSideW(prev.rightW - delta, prev.leftW, threeCols, shellColumnWidth());
        return prev.rightW === next ? prev : { ...prev, rightW: next };
      });
    },
    [toggleSide],
  );

  return (
    <div
      className="builder-shell"
      style={
        {
          "--builder-left": layout.leftOpen ? `${layout.leftW}px` : "auto",
          "--builder-right": layout.rightOpen ? `${layout.rightW}px` : "auto",
        } as CSSProperties
      }
    >
      <h1 className="sr-only">{t("builder.title")}</h1>
      {layout.leftOpen ? (
      <aside className="builder-col builder-col-board">
        <header className="builder-col-head">
          <span className="eyebrow">{t("builder.title")}</span>
          <span className="builder-col-head-actions">
            <button type="button" className="chip-toggle" onClick={() => void handleCreateSession()}>
              <Plus size={12} /> {t("builder.newAgent")}
            </button>
          </span>
        </header>
        <div className="builder-sessions">
          {error !== null ? <div className="builder-session-error">{error}</div> : null}
          {sessions.map((session) => (
            <div
              key={session.id}
              className="builder-session"
              data-active={session.id === activeId}
              data-running={session.running}
            >
              <button
                type="button"
                className="builder-session-main"
                disabled={chatBusy}
                title={chatBusy ? t("builder.swapBlocked") : undefined}
                onClick={() => {
                  // Switching mid-turn would splice one session's stream into another view.
                  if (chatBusy) return;
                  switchSession(session.id);
                }}
              >
                <Bot size={13} />
                {renamingId === session.id ? (
                  <span className="builder-session-rename">
                    <input
                      autoFocus
                      className="builder-rename-input"
                      value={renameDraft}
                      maxLength={60}
                      aria-label={t("builder.renameAria")}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleRename(session.id, renameDraft);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                    />
                    <button
                      type="button"
                      className="builder-session-delete"
                      aria-label={t("builder.renameConfirm")}
                      onClick={() => void handleRename(session.id, renameDraft)}
                    >
                      <Check size={12} />
                    </button>
                    <button
                      type="button"
                      className="builder-session-delete"
                      aria-label={t("builder.renameCancel")}
                      onClick={() => setRenamingId(null)}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ) : (
                <span className="builder-session-name">{session.name}</span>
                )}
                <span className="builder-session-meta">
                  {session.running ? t("builder.running") : t("builder.idle")} · {session.turn_count}
                </span>
              </button>
              {session.running ? (
                <button
                  type="button"
                  className="builder-session-delete"
                  aria-label={t("builder.stop")}
                  title={t("builder.stop")}
                  onClick={() => handleAbortSession(session.id)}
                >
                  <Square size={12} />
                </button>
              ) : (
                <>
                {renamingId !== session.id && (
                <button
                  type="button"
                  className="builder-session-delete"
                  aria-label={t("builder.renameAria")}
                  onClick={() => {
                    setRenameDraft(session.name);
                    setRenamingId(session.id);
                  }}
                >
                  <Pencil size={12} />
                </button>
                )}
                <button
                  type="button"
                  className="builder-session-delete"
                  aria-label={t("builder.delete")}
                  onClick={() => void handleDeleteSession(session.id)}
                >
                  <Trash2 size={12} />
                </button>
                </>
              )}
            </div>
          ))}
        </div>
        {catalog !== null && composition !== null ? (
          <div className="builder-board-wrap">
            <BlockBoard
              catalog={catalog}
              composition={composition}
              onChange={(next) => {
                setComposition(next);
                setDirty(true);
              }}
              onApplySwap={() => void handleApplySwap()}
              dirty={dirty}
              swapBlocked={chatBusy || activeId === null}
            />
          </div>
        ) : (
          <div className="builder-trace-empty">{t("builder.noSession")}</div>
        )}
        <div
          className="builder-resize-handle"
          data-side="left"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("builder.boardHandle")}
          tabIndex={0}
          onPointerDown={startGesture("left")}
          onKeyDown={resizeByKeyboard("left")}
        />
      </aside>
      ) : (
        <div
          className="builder-edge-line"
          data-side="left"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("builder.expandBoard")}
          tabIndex={0}
          onPointerDown={startGesture("left")}
          onKeyDown={resizeByKeyboard("left")}
        />
      )}

      <section className="builder-col builder-col-chat">
        <ChatPanel
          history={history}
          hasSession={activeId !== null}
          running={chatBusy}
          liveSegments={liveSegments}
          onSend={(message, attachments) => handleSend(message, attachments)}
          onStop={handleStop}
        />
      </section>

      {layout.rightOpen ? (
      <aside className="builder-col builder-col-trace">
        <TracePanel
          trace={allTrace}
          turns={turnGroups}
          events={events}
          tab={tab}
          onTabChange={setTab}
          workspaceName={workspace}
          workspaceRefreshToken={wsRefresh}
        />
        <div
          className="builder-resize-handle"
          data-side="right"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("builder.traceHandle")}
          tabIndex={0}
          onPointerDown={startGesture("right")}
          onKeyDown={resizeByKeyboard("right")}
        />
      </aside>
      ) : (
        <div
          className="builder-edge-line"
          data-side="right"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("builder.expandTrace")}
          tabIndex={0}
          onPointerDown={startGesture("right")}
          onKeyDown={resizeByKeyboard("right")}
        />
      )}

      <AskUserModal
        pending={pendingAsk}
        submitting={askSubmitting}
        onAnswer={handleAskAnswer}
        onClose={() => setPendingAsk(null)}
      />
    </div>
  );
}
