/**
 * @file AskUserModal
 * @description Modal for the ask_user human channel: shows each blocking question with
 * its candidate options, a free-text answer, and a skip action.
 *
 * Responsibilities:
 * - Render the pending question batch (from ask_user action args)
 * - Submit per-question answers through the host's transport callback
 * - Dismissal (Escape / backdrop / X) skips unanswered questions explicitly, so a
 *   closed modal never leaves the run waiting on an unreachable batch
 * - Two placements: "centered" (window modal, builder) and "inline" (overlays one
 *   arena column card, so simultaneous columns each pop their own ask window)
 *
 * Shared by Arena and Builder: the modal owns no transport and no namespace-specific copy.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { HelpCircle, Send, X } from "lucide-react";
import type { AskUserQuestion } from "@agentprism/client";
import { useT } from "@/i18n/useT";

/** One pending ask_user batch (one tool call = one modal). */
export interface PendingAskBatch {
  /** Column label / session name shown as the asker. */
  sourceLabel: string;
  /** Asking column's stable identity (arena answer routing; absent for builder, which keys by session). */
  agentId?: string;
  questions: AskUserQuestion[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Flattens nested options arrays the same way the backend does (display only; validation stays backend-side). */
function flatOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const flat: unknown[] = [];
  const push = (item: unknown): void => {
    if (Array.isArray(item)) {
      for (const inner of item) push(inner);
      return;
    }
    flat.push(item);
  };
  for (const item of value) push(item);
  const labels: string[] = [];
  for (const item of flat) {
    if (typeof item === "string") {
      const label = item.trim();
      if (label !== "") labels.push(label);
    }
  }
  return labels;
}

/** Unwraps a stringified batch (`{"input": "<JSON>"}` tolerance, mirrors backend). */
function unwrapInput(record: Record<string, unknown>): Record<string, unknown> {
  let current = record;
  for (let depth = 0; depth < 3; depth += 1) {
    if (current.questions !== undefined) return current;
    if (typeof current.question === "string") return { questions: [current] };
    const inner: unknown = current.input;
    if (typeof inner === "string") {
      try {
        const parsed: unknown = JSON.parse(inner);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return current;
        const lowered: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          lowered[key.toLowerCase()] = value;
        }
        current = lowered;
        continue;
      } catch {
        return current;
      }
    }
    if (inner !== null && typeof inner === "object" && !Array.isArray(inner)) {
      const lowered: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(inner as Record<string, unknown>)) {
        lowered[key.toLowerCase()] = value;
      }
      current = lowered;
      continue;
    }
    return current;
  }
  return current;
}

/** Extracts the question batch from an ask_user action's args (defensive; never throws). */
export function askQuestionsOfArgs(args: Record<string, unknown>): AskUserQuestion[] {
  // Case-tolerant: models occasionally send QUESTIONS/ID/HEADER/QUESTION/OPTIONS
  // uppercased (observed in LangChain/LangGraph columns). Normalizing here keeps
  // the per-column modal popping instead of leaving the run waiting with no UI.
  // Options-tolerant like the backend: double-wrapped arrays flatten to chips.
  // Input-tolerant: some providers deliver `{"input": "<JSON string>"}`.
  const lowered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args ?? {})) lowered[key.toLowerCase()] = value;
  const batch = unwrapInput(lowered);
  const raw = batch.questions;
  if (!Array.isArray(raw)) return [];
  const questions: AskUserQuestion[] = raw
    .filter(isRecord)
    .map((entry, index) => {
      const item: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(entry)) item[key.toLowerCase()] = value;
      return {
        id: typeof item.id === "string" && (item.id as string).trim() !== "" ? (item.id as string) : `q${index + 1}`,
        header: typeof item.header === "string" ? (item.header as string) : "",
        question: typeof item.question === "string" ? (item.question as string) : "",
        options: item.options === undefined ? [] : flatOptions(item.options),
      };
    });
  return questions.filter((question) => question.question !== "");
}

export interface AskUserModalProps {
  pending: PendingAskBatch | null;
  /** True while an answer POST is in flight (disables submit buttons). */
  submitting: boolean;
  /** Delivers one answer; resolves true when the backend accepted it. */
  onAnswer: (questionId: string, answer: string) => Promise<boolean>;
  onClose: () => void;
  /** "centered" (default) is a window modal; "inline" overlays the host container (position: absolute). */
  variant?: "centered" | "inline";
}

/** Modal dialog for one ask_user batch: option chips + free text + skip per question. */
export function AskUserModal({ pending, submitting, onAnswer, onClose, variant = "centered" }: AskUserModalProps) {
  const t = useT();
  const dialogRef = useRef<HTMLDivElement>(null);
  // Per-question answered flags are local UI state: the backend settles the batch
  // once every question has an answer (an empty string counts as an explicit skip).
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    // A new batch resets the per-question state.
    setAnswered(new Set());
    setDrafts({});
  }, [pending]);

  // Manual dismissal (Escape / backdrop / X) skips every unanswered question:
  // there is no reopen UI, so leaving the batch pending would stall the run for
  // its whole server-side wait window with no way to reach it again.
  // All dismiss call sites render only with a batch present; the guard exists
  // for the type system because the definition sits above the null return.
  const dismiss = () => {
    if (pending === null) return;
    for (const question of pending.questions) {
      if (!answered.has(question.id)) void onAnswer(question.id, "");
    }
    onClose();
  };

  useEffect(() => {
    // Escape-to-skip is a window-modal affordance only: inline (per-column) dialogs
    // must not let a global keypress skip a batch the user is answering elsewhere.
    if (pending === null || variant !== "centered") return;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, onClose, variant]);

  // The tool settles the batch only when every question has an answer; once the
  // last one is submitted here, ask the host to close (the run then continues).
  useEffect(() => {
    if (pending !== null && pending.questions.length > 0 && answered.size >= pending.questions.length) {
      onClose();
    }
  }, [pending, answered, onClose]);

  if (pending === null) return null;

  const submit = async (questionId: string, answer: string) => {
    const accepted = await onAnswer(questionId, answer);
    if (accepted) {
      setAnswered((prev) => new Set(prev).add(questionId));
    }
  };

  const dialog = (
    <div
      ref={dialogRef}
      className="arena-modal"
      data-inline={variant === "inline" ? "true" : undefined}
      role="dialog"
      aria-modal={variant === "centered" ? "true" : undefined}
      aria-label={t("common.askTitle")}
      tabIndex={-1}
    >
      <div className="arena-modal-head">
        <p className="arena-modal-title flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-primary" aria-hidden />
          {t("common.askTitle")}
        </p>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {t("common.askFrom")} {pending.sourceLabel}
        </span>
        <button type="button" className="btn-ghost !h-7 !w-7 !p-0" onClick={dismiss} aria-label={t("common.cancel")}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="arena-modal-body flex flex-col gap-3">
        <p className="text-[11px] text-muted-foreground">{t("common.askWaiting")}</p>
        {pending.questions.map((question) => {
          const done = answered.has(question.id);
          return (
            <div key={question.id} className="rounded-[var(--radius-sm)] border border-border px-3 py-2">
              <p className="text-sm font-medium text-foreground">
                {question.header !== "" ? `${question.header} · ` : ""}
                {question.question}
              </p>
              {done ? (
                <p className="mt-1 text-xs text-muted-foreground">{t("common.askAnswered")}</p>
              ) : (
                <>
                  {question.options.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {question.options.map((option) => (
                        <button
                          key={option}
                          type="button"
                          className="chip-toggle"
                          disabled={submitting}
                          onClick={() => void submit(question.id, option)}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-1.5">
                    <input
                      className="form-input h-8 flex-1 text-xs"
                      value={drafts[question.id] ?? ""}
                      placeholder={t("common.askAnswerPlaceholder")}
                      disabled={submitting}
                      onChange={(event) => setDrafts((prev) => ({ ...prev, [question.id]: event.target.value }))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          void submit(question.id, drafts[question.id] ?? "");
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn-primary !h-8 !px-2.5 text-xs"
                      disabled={submitting}
                      onClick={() => void submit(question.id, drafts[question.id] ?? "")}
                    >
                      <Send className="h-3 w-3" aria-hidden />
                      {t("common.askSend")}
                    </button>
                    <button
                      type="button"
                      className="chip-toggle"
                      disabled={submitting}
                      onClick={() => void submit(question.id, "")}
                    >
                      {t("common.askSkip")}
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  // Inline dialogs overlay only their host container (an arena column card), so
  // simultaneous columns each pop an independent ask window instead of sharing
  // one page-centered modal.
  if (variant === "inline") {
    return <div className="arena-ask-inline">{dialog}</div>;
  }
  return (
    <>
      <div className="arena-modal-backdrop" aria-hidden onClick={dismiss} />
      {dialog}
    </>
  );
}
