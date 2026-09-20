/**
 * @file ComposerBar
 * @description Run bar: suggested questions, attachments, error banner, question input.
 *
 * Responsibilities:
 * - Suggest questions when the input gains focus (5 random, then match-filtered;
 *   cancelled from the third typed character without matches)
 * - Collect text-file attachments seeded into the run workspaces
 * - Show run errors and collect the question input, then start the run
 *
 * The old task-template picker is gone: picking a suggestion applies its template
 * (suggested dimension + auto-judge) implicitly.
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { deriveTurn } from "./useColumnSessions";
import type { ColumnSessionState } from "./useColumnSessions";
import { History, Paperclip, RotateCcw, Send, Square, X } from "lucide-react";
import type { RunAttachment } from "@agentprism/client";
import type { TaskTemplate } from "@agentprism/client";
import { QuestionSuggest, type SuggestItem } from "./QuestionSuggest";
import { templateName, templateQuestion } from "./templateLabels";
import { useT } from "@/i18n/useT";

export interface ComposerBarProps {
  error: string | null;
  sessions: Record<string, ColumnSessionState>;
  historySeedLabel: string | null;
  /** Locale overlay for the pipeline aggregation key shown in history chrome. */
  resolveLabel?: (label: string) => string;
  onClearConversation: () => void;
  running: boolean;
  templates: TaskTemplate[];
  onApplyTemplate: (template: TaskTemplate) => void;
  question: string;
  onQuestionChange: (value: string) => void;
  attachments: RunAttachment[];
  onAttachFiles: (files: File[]) => void;
  onRemoveAttachment: (name: string) => void;
  activeSelectionCount: number;
  onRequestRun: () => void;
  onRequireSelection: () => void;
  onStop: () => void;
}

/** Random draw size for the initial (untyped) suggestion list. */
const SUGGEST_COUNT = 5;

/**
 * Deterministic PRNG (mulberry32). The suggestion shuffle runs inside useMemo,
 * which must stay pure, so the draw is seeded by the focus counter instead of
 * Math.random(); each focus bumps the seed and still deals a fresh hand.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

/** Run bar: suggestions, attachments, shared chat history, and question input. */
export function ComposerBar({
  error,
  sessions,
  historySeedLabel,
  resolveLabel,
  onClearConversation,
  running,
  templates,
  onApplyTemplate,
  question,
  onQuestionChange,
  attachments,
  onAttachFiles,
  onRemoveAttachment,
  activeSelectionCount,
  onRequestRun,
  onRequireSelection,
  onStop,
}: ComposerBarProps) {
  const t = useT();
  /** Session meta stays collapsed by default; the run-strip chip keeps it one click away. */
  const [historyOpen, setHistoryOpen] = useState(false);
  /** Suggestion list visibility and keyboard-cursor position (-1 = none highlighted). */
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestSeed, setSuggestSeed] = useState(0);
  const [suggestActive, setSuggestActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A pending blur-close timer must not fire into an unmounted component.
  useEffect(() => () => {
    if (blurTimerRef.current !== null) clearTimeout(blurTimerRef.current);
  }, []);

  // A run only hides the dropdown via `!running`; the open flag itself must reset
  // too. Otherwise the stale open state resurrects the list the moment the run
  // settles (e.g. after an Enter-key run with the list still open).
  useEffect(() => {
    if (running) {
      setSuggestOpen(false);
      setSuggestActive(-1);
    }
  }, [running]);

  const seedDisplay =
    historySeedLabel && resolveLabel ? resolveLabel(historySeedLabel) : historySeedLabel;
  const sessionEntries = Object.entries(sessions).filter(([, s]) => s.messages.length > 0);
  const hasSessions = sessionEntries.length > 0 || Boolean(historySeedLabel);
  const maxTurns = sessionEntries.reduce((max, [, s]) => Math.max(max, deriveTurn(s.messages) - 1), 0);

  const pool = useMemo<SuggestItem[]>(
    () =>
      templates.map((tpl) => ({
        id: tpl.id,
        name: templateName(t, tpl.id, tpl.name),
        question: templateQuestion(t, tpl.id, tpl.question),
      })),
    [templates, t],
  );

  const randomFive = useMemo<SuggestItem[]>(() => {
    const random = mulberry32(suggestSeed);
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const a = shuffled[i];
      const b = shuffled[j];
      if (a === undefined || b === undefined) continue;
      shuffled[i] = b;
      shuffled[j] = a;
    }
    return shuffled.slice(0, SUGGEST_COUNT);
    // suggestSeed re-draws a fresh hand on every focus
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, suggestSeed]);

  const query = question.trim();
  const matched = useMemo(() => {
    if (query.length < 2) return [];
    const needle = query.toLowerCase();
    return pool.filter((item) => item.question.toLowerCase().includes(needle)).slice(0, SUGGEST_COUNT);
  }, [pool, query]);

  /**
   * Spec: focus shows 5 random questions; from two typed characters matching kicks
   * in; from the third character without a match the suggestions are cancelled.
   */
  const suggestItems: SuggestItem[] =
    query.length >= 2 && matched.length > 0 ? matched : query.length >= 3 ? [] : randomFive;
  const suggestionsVisible = suggestOpen && !running && suggestItems.length > 0;

  const openSuggestions = () => {
    if (running) return;
    setSuggestSeed((s) => s + 1);
    setSuggestActive(-1);
    setSuggestOpen(true);
  };

  const pickSuggestion = (item: SuggestItem) => {
    onQuestionChange(item.question);
    const template = templates.find((tpl) => tpl.id === item.id);
    if (template) onApplyTemplate(template);
    setSuggestOpen(false);
    inputRef.current?.focus();
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (suggestionsVisible && event.key === "ArrowDown") {
      event.preventDefault();
      setSuggestActive((i) => Math.min(suggestItems.length - 1, i + 1));
      return;
    }
    if (suggestionsVisible && event.key === "ArrowUp") {
      event.preventDefault();
      setSuggestActive((i) => Math.max(-1, i - 1));
      return;
    }
    if (suggestionsVisible && event.key === "Escape") {
      event.preventDefault();
      setSuggestOpen(false);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      // Enter always dismisses the list (run, pick, or validation hint alike),
      // so no stale open state lingers behind modals or the run itself.
      setSuggestOpen(false);
      const activeItem = suggestionsVisible && suggestActive >= 0 ? suggestItems[suggestActive] : undefined;
      if (activeItem !== undefined) {
        pickSuggestion(activeItem);
        return;
      }
      if (activeSelectionCount < 1) {
        onRequireSelection();
        return;
      }
      onRequestRun();
    }
  };

  return (
    <section className="composer-bar">
      <div className="soft-collapse" data-open={error ? "true" : undefined} aria-hidden={!error}>
        <div className="soft-collapse-inner">
          <p
            role={error ? "alert" : undefined}
            className="composer-alert text-xs text-destructive border border-destructive/30 bg-destructive/5 rounded-[var(--radius-sm)] px-3 py-1.5 mb-2"
          >
            {error}
          </p>
        </div>
      </div>
      <div
        className="arena-chat-history"
        data-open={hasSessions && historyOpen ? "true" : undefined}
        aria-hidden={!hasSessions || !historyOpen}
        {...(!hasSessions || !historyOpen ? { inert: true } : {})}
      >
        <div className="arena-chat-history-inner">
          <div className="arena-chat-history-head">
            <span className="eyebrow">{t("arena.history.title")}</span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {t("arena.history.independent", { count: sessionEntries.length })}
              {maxTurns > 0 ? ` · ${t("arena.history.turnCount", { count: maxTurns })}` : ""}
              {seedDisplay ? t("arena.history.seed", { name: seedDisplay }) : ""}
            </span>
          </div>
          <p className="arena-chat-history-note">{t("arena.history.independentHint")}</p>
        </div>
      </div>
      {attachments.length > 0 && (
        <div className="composer-attachments" role="list" aria-label={t("arena.attach.label")}>
          {attachments.map((file) => (
            <span key={file.name} className="composer-attachment-chip" role="listitem">
              <span className="composer-attachment-name">{file.name}</span>
              <span className="composer-attachment-size">{(file.content.length / 1024).toFixed(1)} KB</span>
              <button
                type="button"
                className="composer-attachment-remove"
                onClick={() => onRemoveAttachment(file.name)}
                aria-label={t("arena.attach.removeAria", { name: file.name })}
              >
                <X className="h-2.5 w-2.5" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="arena-run-strip">
        <button
          type="button"
          className="chip-toggle chip-toggle-strip"
          data-open={hasSessions && historyOpen ? "true" : undefined}
          onClick={() => setHistoryOpen((v) => !v)}
          disabled={!hasSessions}
          aria-expanded={hasSessions ? historyOpen : undefined}
          title={t("arena.history.title")}
        >
          <History className="h-3.5 w-3.5" aria-hidden />
          {maxTurns > 0 && (
            <span className="chip-toggle-count">{t("arena.history.turnCount", { count: maxTurns })}</span>
          )}
        </button>
        <button
          type="button"
          className="chip-toggle chip-toggle-strip"
          onClick={onClearConversation}
          disabled={running || !hasSessions}
          aria-label={t("arena.history.newChat")}
          title={t("arena.history.newChat")}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          className="chip-toggle chip-toggle-strip"
          onClick={() => fileInputRef.current?.click()}
          disabled={running}
          aria-label={t("arena.attach.add")}
          title={t("arena.attach.add")}
        >
          <Paperclip className="h-3.5 w-3.5" aria-hidden />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          accept=".txt,.md,.markdown,.json,.csv,.log,.py,.js,.ts,.tsx,.jsx,.html,.css,.yaml,.yml,.toml,.ini,.xml,.sql,.sh,.ps1,.java,.c,.cpp,.h,.go,.rs,.rb,.php"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            if (files.length > 0) onAttachFiles(files);
          }}
          aria-hidden
          tabIndex={-1}
        />
        <div className="composer-input-wrap">
          <input
            ref={inputRef}
            className="form-input arena-run-strip-input"
            placeholder={sessionEntries.length > 0 ? t("arena.composer.placeholderFollowUp") : t("arena.composer.placeholder")}
            value={question}
            onChange={(e) => onQuestionChange(e.target.value)}
            onFocus={() => openSuggestions()}
            onBlur={() => {
              if (blurTimerRef.current !== null) clearTimeout(blurTimerRef.current);
              blurTimerRef.current = setTimeout(() => setSuggestOpen(false), 120);
            }}
            onKeyDown={onInputKeyDown}
            disabled={running}
            aria-label={t("arena.composer.questionAria")}
            aria-autocomplete="list"
          />
          {suggestionsVisible && (
            <QuestionSuggest
              anchorRef={inputRef}
              items={suggestItems}
              activeIndex={suggestActive}
              ariaLabel={t("arena.composer.suggestAria")}
              onPick={pickSuggestion}
              onHover={setSuggestActive}
              onClose={() => setSuggestOpen(false)}
            />
          )}
        </div>
        <button
          type="button"
          className="composer-run"
          data-running={running ? "true" : undefined}
          disabled={!running && !question.trim()}
          title={
            running
              ? t("arena.composer.stopTitle")
              : activeSelectionCount < 1
                ? t("arena.composer.needSetupTitle")
                : undefined
          }
          onClick={() => {
            if (running) {
              onStop();
              return;
            }
            if (activeSelectionCount < 1) {
              onRequireSelection();
              return;
            }
            onRequestRun();
          }}
        >
          {running ? (
            <>
              <Square className="h-4 w-4" />
              {t("arena.action.stop")}
            </>
          ) : (
            <>
              <Send className="h-4 w-4" />
              {t("arena.action.run")}
            </>
          )}
        </button>
      </div>
    </section>
  );
}
