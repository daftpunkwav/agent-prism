/**
 * @file ModelModal
 * @description Independent dialog for adding or editing one model slot.
 *
 * Responsibilities:
 * - Own the edited draft locally so Cancel discards everything
 * - Edit identity, token budgets, capability flags, and thinking config
 * - Offer vendor-defined thinking levels on OpenAI-compatible formats
 *
 * Visual language matches the arena dialogs (backdrop, panel, head, body)
 * and the settings form controls (form-input, UiSelect, Field).
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { NumberInput, UiSelect } from "@agentprism/ui";
import { useT } from "@/i18n/useT";
import type { ModelSlot } from "./settingsConnectionModel";
import { Field } from "./Field";

export interface ModelModalProps {
  initial: ModelSlot;
  isNew: boolean;
  defaultEndpointId: string;
  onSetDefault(modelId: string): void;
  onClose(): void;
  onSave(draft: ModelSlot): void;
}

/** Effective level options: vendor-defined levels replace the standard set when present. */
function levelOptions(
  thinkingLevels: string[],
  label: (value: string) => string,
): Array<{ value: string; label: string }> {
  if (thinkingLevels.length > 0) {
    return [{ value: "off", label: label("off") }, ...thinkingLevels.map((name) => ({ value: name, label: name }))];
  }
  return ["off", "low", "medium", "high"].map((value) => ({ value, label: label(value) }));
}

/** Token-count input ceiling: mirrors the backend parse range so a stray typed value never becomes a 422. */
const TOKEN_INPUT_MAX = 10_000_000;

/** Independent model editor dialog: add and edit share this one window. */
export function ModelModal({ initial, isNew, defaultEndpointId, onSetDefault, onClose, onSave }: ModelModalProps) {
  const t = useT();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<ModelSlot>(initial);

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

  const levelLabel = (value: string) =>
    value === "low"
      ? t("settings.model.levelLow")
      : value === "medium"
        ? t("settings.model.levelMedium")
        : value === "high"
          ? t("settings.model.levelHigh")
          : t("settings.model.levelOff");
  const options = levelOptions(draft.thinking_levels, levelLabel);
  const budgetError =
    draft.thinking_budget_tokens > 0 &&
    draft.thinking_max_tokens > 0 &&
    draft.thinking_max_tokens <= draft.thinking_budget_tokens;
  const canSave = draft.model.trim() !== "" && !budgetError;

  const patch = (p: Partial<ModelSlot>) => setDraft((d) => ({ ...d, ...p }));

  const setLevels = (levels: string[]) => {
    const cleaned = levels.map((l) => l.slice(0, 32));
    const selectedKept = draft.thinking_level === "off" || cleaned.some((l) => l.trim() !== "" && l === draft.thinking_level);
    patch({ thinking_levels: cleaned, thinking_level: selectedKept ? draft.thinking_level : "off" });
  };

  const commit = () => {
    if (!canSave) return;
    const levels = draft.thinking_levels.map((l) => l.trim()).filter((l, i, arr) => l !== "" && arr.indexOf(l) === i).slice(0, 16);
    const effective = levels.length > 0 ? levels : [];
    const levelKept = draft.thinking_level === "off" || (effective.length > 0 ? effective.includes(draft.thinking_level) : ["low", "medium", "high"].includes(draft.thinking_level));
    onSave({
      ...draft,
      model: draft.model.trim(),
      label: draft.label.trim(),
      thinking_levels: effective.length > 0 ? levels : [],
      thinking_level: draft.thinking_capable && levelKept ? draft.thinking_level : "off",
    });
  };

  return (
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
                onChange={(context_window) => patch({ context_window })}
              />
            </Field>
            <Field label={t("settings.model.maxInput")}>
              <NumberInput
                className="form-input font-mono text-sm"
                integer
                min={256}
                value={draft.max_input_tokens}
                onChange={(max_input_tokens) => patch({ max_input_tokens })}
              />
            </Field>
            <Field label={t("settings.model.maxOutput")}>
              <NumberInput
                className="form-input font-mono text-sm"
                integer
                min={64}
                value={draft.max_output_tokens}
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

          {/* Thinking: capability, level, budget pair, vendor levels. */}
          <div className="rounded-lg border border-border/60 p-3.5 space-y-3">
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                className="accent-[var(--primary)]"
                checked={draft.thinking_capable}
                onChange={(e) => {
                  const fallback = options.some((o) => o.value === "medium") ? "medium" : (options[1]?.value ?? "off");
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
            <Field label={t("settings.model.defaultThinkingLevel")}>
              <UiSelect
                className="w-full"
                disabled={!draft.thinking_capable}
                value={draft.thinking_capable ? draft.thinking_level : "off"}
                onChange={(value) => patch({ thinking_level: value })}
                ariaLabel={t("settings.model.defaultThinkingLevel")}
                options={options}
              />
            </Field>
            {draft.thinking_capable && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label={t("settings.model.thinkingBudgetTokens")}>
                    <NumberInput
                      className="form-input font-mono text-sm"
                      integer
                      min={0}
                      max={TOKEN_INPUT_MAX}
                      value={draft.thinking_budget_tokens}
                      onChange={(thinking_budget_tokens) => patch({ thinking_budget_tokens })}
                    />
                  </Field>
                  <Field label={t("settings.model.thinkingOutputTokens")}>
                    <NumberInput
                      className="form-input font-mono text-sm"
                      integer
                      min={0}
                      max={TOKEN_INPUT_MAX}
                      value={draft.thinking_max_tokens}
                      onChange={(thinking_max_tokens) => patch({ thinking_max_tokens })}
                    />
                  </Field>
                </div>
                {budgetError && (
                  <p className="text-[11px] text-destructive leading-relaxed">{t("settings.model.thinkingBudgetError")}</p>
                )}
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
    </>
  );
}
