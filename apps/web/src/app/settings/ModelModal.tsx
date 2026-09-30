/**
 * @file ModelModal
 * @description Independent dialog for adding or editing one model slot.
 *
 * Responsibilities:
 * - Own the edited draft locally so Cancel discards everything
 * - Edit identity, token budgets, capability flags, and thinking config
 * - Branch thinking config by API format: OpenAI-compatible formats only map
 *   named levels; anthropic messages additionally offers the budget-pair mode
 *   (one tab per mode, the active tab is the applied mode — mutually exclusive)
 *
 * Visual language matches the arena dialogs (backdrop, panel, head, body)
 * and the settings form controls (form-input, UiSelect, Field).
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, X } from "lucide-react";
import { NumberInput, UiSelect } from "@agentprism/ui";
import { useT } from "@/i18n/useT";
import type { ModelSlot } from "./settingsConnectionModel";
import { Field } from "./Field";

export interface ModelModalProps {
  initial: ModelSlot;
  isNew: boolean;
  /** Connection-group wire format; gates which thinking editors this dialog shows. */
  apiFormat: string;
  defaultEndpointId: string;
  onSetDefault(modelId: string): void;
  onClose(): void;
  onSave(draft: ModelSlot): void;
}

/** Effective level options: vendor-defined levels replace the standard set when present. Levels render verbatim (vendor-defined tokens have no translation). */
function levelOptions(thinkingLevels: string[]): Array<{ value: string; label: string }> {
  if (thinkingLevels.length > 0) {
    return [{ value: "off", label: "off" }, ...thinkingLevels.map((name) => ({ value: name, label: name }))];
  }
  return ["off", "low", "medium", "high"].map((value) => ({ value, label: value }));
}

/** Budget-mode level options: off plus the pair table's level names. */
function budgetLevelOptions(pairs: Array<{ level: string; budget_tokens: number; max_tokens: number }>): Array<{ value: string; label: string }> {
  return [{ value: "off", label: "off" }, ...pairs.map((pair) => ({ value: pair.level, label: pair.level }))];
}

/** Token-count input ceiling: mirrors the backend parse range so a stray typed value never becomes a 422. */
const TOKEN_INPUT_MAX = 10_000_000;
/** Anthropic protocol floor for budget_tokens; below it the request would silently drop thinking. */
const BUDGET_FLOOR = 1024;

/** Independent model editor dialog: add and edit share this one window. */
export function ModelModal({ initial, isNew, apiFormat, defaultEndpointId, onSetDefault, onClose, onSave }: ModelModalProps) {
  const t = useT();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<ModelSlot>(initial);
  const isAnthropic = apiFormat === "anthropic_messages";

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (first === undefined || last === undefined) return;
        const current = document.activeElement;
        if (event.shiftKey) {
          if (current === first || current === dialogRef.current) {
            event.preventDefault();
            last.focus();
          }
        } else if (current === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const options = levelOptions(draft.thinking_levels);
  // Older JSON-imported rows may not carry the pair table at all.
  const budgetPairs = draft.thinking_budget_pairs ?? [];
  const budgetOptions = budgetLevelOptions(budgetPairs);
  // A pair whose output cap does not exceed its budget would be silently dropped
  // by the backend clamp (max → 0); block the save instead so the typo surfaces.
  const pairError = budgetPairs.some(
    (pair) => pair.budget_tokens > 0 && pair.max_tokens > 0 && pair.max_tokens <= pair.budget_tokens,
  );
  const pairLowBudget = budgetPairs.some((pair) => pair.budget_tokens > 0 && pair.budget_tokens < BUDGET_FLOOR);
  const canSave = draft.model.trim() !== "" && !pairError;

  const patch = (p: Partial<ModelSlot>) => setDraft((d) => ({ ...d, ...p }));

  const setLevels = (levels: string[]) => {
    const cleaned = levels.map((l) => l.slice(0, 32));
    const selectedKept = draft.thinking_level === "off" || cleaned.some((l) => l.trim() !== "" && l === draft.thinking_level);
    patch({ thinking_levels: cleaned, thinking_level: selectedKept ? draft.thinking_level : "off" });
  };

  const setPairs = (pairs: NonNullable<ModelSlot["thinking_budget_pairs"]>) => {
    const cleaned = pairs.map((pair) => ({ ...pair, level: pair.level.slice(0, 32) }));
    const selectedKept =
      draft.thinking_level === "off" || cleaned.some((pair) => pair.level.trim() !== "" && pair.level === draft.thinking_level);
    patch({ thinking_budget_pairs: cleaned, thinking_level: selectedKept ? draft.thinking_level : "off" });
  };

  /** Switching the applied mode is the tab click: a default level the other mode cannot represent resets to off. */
  const switchMode = (mode: "levels" | "budget") => {
    if (mode === draft.thinking_mode) return;
    const allowed =
      mode === "budget"
        ? budgetPairs.map((pair) => pair.level)
        : draft.thinking_levels.length > 0
          ? draft.thinking_levels
          : ["low", "medium", "high"];
    patch({
      thinking_mode: mode,
      thinking_level: draft.thinking_level === "off" || allowed.includes(draft.thinking_level) ? draft.thinking_level : "off",
    });
  };

  const commit = () => {
    if (!canSave) return;
    const levels = draft.thinking_levels.map((l) => l.trim()).filter((l, i, arr) => l !== "" && arr.indexOf(l) === i).slice(0, 16);
    const pairs = budgetPairs
      .map((pair) => ({ ...pair, level: pair.level.trim() }))
      .filter((pair, i, arr) => pair.level !== "" && arr.findIndex((other) => other.level === pair.level) === i)
      .slice(0, 16);
    const levelAllowed =
      draft.thinking_mode === "budget" && isAnthropic
        ? pairs.map((pair) => pair.level)
        : levels.length > 0
          ? levels
          : ["low", "medium", "high"];
    const levelKept = draft.thinking_level === "off" || levelAllowed.includes(draft.thinking_level);
    onSave({
      ...draft,
      model: draft.model.trim(),
      label: draft.label.trim(),
      thinking_levels: levels,
      thinking_budget_pairs: isAnthropic ? pairs : [],
      // Budget mode is an anthropic-only concept; other formats always stay level-mapped.
      thinking_mode: isAnthropic && draft.thinking_mode === "budget" ? "budget" : "levels",
      thinking_level: draft.thinking_capable && levelKept ? draft.thinking_level : "off",
    });
  };

  // Portal to body: a filled page-enter animation leaves an identity transform on
  // <main>, which becomes the containing block for position:fixed children and
  // drags the centered dialog off the viewport on scrollable pages.
  return createPortal(
    <>
      <button
        type="button"
        className="arena-modal-backdrop"
        aria-label={t("settings.model.modalCloseAria")}
        onClick={onClose}
        tabIndex={-1}
      />
      <div
        ref={dialogRef}
        className="arena-modal"
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? t("settings.connection.addModel") : t("settings.model.editTitle")}
        tabIndex={-1}
      >
        <div className="arena-modal-head">
          <p className="arena-modal-title">{isNew ? t("settings.connection.addModel") : t("settings.model.editTitle")}</p>
          <button
            type="button"
            className="btn-ghost !h-7 !w-7 !p-0 ml-auto"
            onClick={onClose}
            aria-label={t("settings.model.modalCloseAria")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="arena-modal-body space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <Field label={t("settings.model.labelPlaceholder")}>
              <input
                className="form-input text-sm"
                value={draft.label}
                placeholder={t("settings.model.labelPlaceholder")}
                aria-label={t("settings.model.labelAria", { index: 1 })}
                onChange={(e) => patch({ label: e.target.value })}
              />
            </Field>
            <Field label="model id">
              <input
                className="form-input font-mono text-sm"
                value={draft.model}
                required
                placeholder="model id"
                aria-label={t("settings.model.modelIdAria", { index: 1 })}
                onChange={(e) => patch({ model: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <Field label={t("settings.model.contextWindow")}>
              <NumberInput
                className="form-input font-mono text-sm"
                integer
                min={1024}
                value={draft.context_window}
                invalidMessage={t("settings.model.invalidNumber")}
                onChange={(context_window) => patch({ context_window })}
              />
            </Field>
            <Field label={t("settings.model.maxInput")}>
              <NumberInput
                className="form-input font-mono text-sm"
                integer
                min={256}
                value={draft.max_input_tokens}
                invalidMessage={t("settings.model.invalidNumber")}
                onChange={(max_input_tokens) => patch({ max_input_tokens })}
              />
            </Field>
            <Field label={t("settings.model.maxOutput")}>
              <NumberInput
                className="form-input font-mono text-sm"
                integer
                min={64}
                value={draft.max_output_tokens}
                invalidMessage={t("settings.model.invalidNumber")}
                onChange={(max_output_tokens) => patch({ max_output_tokens })}
              />
            </Field>
          </div>

          {/* Toggle cluster: two aligned columns, one control per row. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5 text-sm">
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                className="accent-[var(--primary)]"
                checked={draft.image_input}
                onChange={(e) => patch({ image_input: e.target.checked })}
              />
              {t("settings.model.imageInput")}
            </label>
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                className="accent-[var(--primary)]"
                checked={draft.video_input}
                onChange={(e) => patch({ video_input: e.target.checked })}
              />
              {t("settings.model.videoInput")}
            </label>
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                className="accent-[var(--primary)]"
                checked={draft.enabled !== false}
                onChange={(e) => patch({ enabled: e.target.checked })}
              />
              {t("settings.model.enabledLabel")}
            </label>
            {/* Hidden for new drafts: a local id never survives submit (it is
                stripped to "" for create), so a default picked here would dangle. */}
            {!isNew && (
              <label className="flex items-center gap-2 text-xs text-foreground">
                <input
                  type="checkbox"
                  className="accent-[var(--primary)]"
                  checked={draft.id === defaultEndpointId}
                  onChange={() => onSetDefault(draft.id)}
                />
                {t("settings.model.setDefaultTitle")}
              </label>
            )}
          </div>

          {/* Thinking: capability switch, then per-format editors. */}
          <div className="rounded-lg border border-border/60 p-3.5 space-y-3">
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                className="accent-[var(--primary)]"
                checked={draft.thinking_capable}
                onChange={(e) => {
                  const pool = isAnthropic && draft.thinking_mode === "budget" ? budgetOptions : options;
                  const fallback = pool.some((o) => o.value === "medium") ? "medium" : (pool[1]?.value ?? "off");
                  patch({
                    thinking_capable: e.target.checked,
                    thinking_level: e.target.checked
                      ? draft.thinking_level === "off"
                        ? fallback
                        : draft.thinking_level
                      : "off",
                  });
                }}
              />
              {t("settings.model.thinkingCapable")}
            </label>

            {isAnthropic && (
              <div className="flex gap-1 rounded-lg bg-muted/60 p-1 text-xs" role="tablist">
                {(["levels", "budget"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={draft.thinking_mode === mode}
                    disabled={!draft.thinking_capable}
                    className={
                      draft.thinking_mode === mode
                        ? "flex-1 rounded-md bg-background px-2 py-1.5 font-medium text-foreground shadow-sm"
                        : "flex-1 rounded-md px-2 py-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
                    }
                    onClick={() => switchMode(mode)}
                  >
                    {mode === "levels" ? t("settings.model.thinkingTabLevels") : t("settings.model.thinkingTabBudget")}
                  </button>
                ))}
              </div>
            )}

            {!isAnthropic && (
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {t("settings.model.openaiFormatHint")}
              </p>
            )}

            {draft.thinking_capable && (!isAnthropic || draft.thinking_mode === "levels") && (
              <>
                <Field label={t("settings.model.defaultThinkingLevel")}>
                  <UiSelect
                    className="w-full"
                    value={draft.thinking_level}
                    onChange={(value) => patch({ thinking_level: value })}
                    ariaLabel={t("settings.model.defaultThinkingLevel")}
                    options={options}
                  />
                </Field>
                <div className="space-y-2">
                  <p className="eyebrow">{t("settings.model.customLevels")}</p>
                  {draft.thinking_levels.map((lv, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        className="form-input font-mono text-sm"
                        value={lv}
                        placeholder={t("settings.model.customLevelPlaceholder")}
                        aria-label={t("settings.model.customLevelAria", { index: index + 1 })}
                        onChange={(e) => {
                          const next = [...draft.thinking_levels];
                          next[index] = e.target.value;
                          setLevels(next);
                        }}
                      />
                      <button
                        type="button"
                        className="btn-ghost !h-8 !w-8 !p-0 shrink-0"
                        aria-label={t("settings.model.customLevelRemoveAria", { index: index + 1 })}
                        onClick={() => setLevels(draft.thinking_levels.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn-ghost !h-8 text-xs"
                    disabled={draft.thinking_levels.length >= 16}
                    onClick={() => setLevels([...draft.thinking_levels, ""])}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t("settings.model.customLevelAdd")}
                  </button>
                </div>
              </>
            )}

            {isAnthropic && draft.thinking_capable && draft.thinking_mode === "budget" && (
              <>
                <Field label={t("settings.model.defaultBudgetLevel")}>
                  <UiSelect
                    className="w-full"
                    value={draft.thinking_level}
                    onChange={(value) => patch({ thinking_level: value })}
                    ariaLabel={t("settings.model.defaultBudgetLevel")}
                    options={budgetOptions}
                  />
                </Field>
                <div className="space-y-2">
                  <p className="eyebrow">{t("settings.model.budgetPairs")}</p>
                  <div className="grid grid-cols-[1fr_7rem_7rem_2rem] gap-2 text-[11px] text-muted-foreground">
                    <span>{t("settings.model.budgetPairLevel")}</span>
                    <span>{t("settings.model.budgetPairBudget")}</span>
                    <span>{t("settings.model.budgetPairMax")}</span>
                    <span />
                  </div>
                  {budgetPairs.map((pair, index) => (
                    <div key={index} className="grid grid-cols-[1fr_7rem_7rem_2rem] items-center gap-2">
                      <input
                        className="form-input font-mono text-sm"
                        value={pair.level}
                        placeholder={t("settings.model.budgetPairLevelPlaceholder")}
                        aria-label={t("settings.model.budgetPairLevelAria", { index: index + 1 })}
                        onChange={(e) => {
                          const next = [...budgetPairs];
                          next[index] = { ...pair, level: e.target.value };
                          setPairs(next);
                        }}
                      />
                      <NumberInput
                        className="form-input font-mono text-sm"
                        integer
                        min={0}
                        max={TOKEN_INPUT_MAX}
                        value={pair.budget_tokens}
                        invalidMessage={t("settings.model.invalidNumber")}
                        onChange={(budget_tokens) => {
                          const next = [...budgetPairs];
                          next[index] = { ...pair, budget_tokens };
                          setPairs(next);
                        }}
                      />
                      <NumberInput
                        className="form-input font-mono text-sm"
                        integer
                        min={0}
                        max={TOKEN_INPUT_MAX}
                        value={pair.max_tokens}
                        invalidMessage={t("settings.model.invalidNumber")}
                        onChange={(max_tokens) => {
                          const next = [...budgetPairs];
                          next[index] = { ...pair, max_tokens };
                          setPairs(next);
                        }}
                      />
                      <button
                        type="button"
                        className="btn-ghost !h-8 !w-8 !p-0 shrink-0"
                        aria-label={t("settings.model.budgetPairRemoveAria", { index: index + 1 })}
                        onClick={() => setPairs(budgetPairs.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn-ghost !h-8 text-xs"
                    disabled={budgetPairs.length >= 16}
                    onClick={() => setPairs([...budgetPairs, { level: "", budget_tokens: 0, max_tokens: 0 }])}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t("settings.model.budgetPairAdd")}
                  </button>
                  {pairError && (
                    <p className="text-[11px] text-destructive leading-relaxed">{t("settings.model.budgetPairError")}</p>
                  )}
                  {!pairError && pairLowBudget && (
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {t("settings.model.budgetPairLowWarning", { floor: BUDGET_FLOOR })}
                    </p>
                  )}
                </div>
              </>
            )}
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {t("settings.model.modalGuideHint")}
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-ghost !h-9 text-xs" onClick={onClose}>
              {t("settings.model.modalCancel")}
            </button>
            <button type="button" className="btn-primary !h-9 text-xs" disabled={!canSave} onClick={commit}>
              {t("settings.model.modalSave")}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
