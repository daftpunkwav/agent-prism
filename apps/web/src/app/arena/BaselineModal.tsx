/**
 * @file BaselineModal
 * @description Controlled-variable baseline settings presented as a modal dialog.
 *
 * Responsibilities:
 * - Host the baseline groups form that used to collapse inside the setup strip
 * - Keep the setup strip's geometry stable: opening settings never resizes the page
 * - Surface dimension-scoped banners (model readiness / prompt hint) as context
 *
 * Escape, backdrop, and the close button all dismiss; field semantics are unchanged
 * from the previous inline form.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { HelpCircle, X } from "lucide-react";
import type { ArenaMeta, BaselineOverrides, DimensionId } from "@agentprism/client";
import { UiSelect } from "@agentprism/ui";
import { BASELINE_GROUP_ORDER } from "./arenaConstants";
import { useT } from "@/i18n/useT";
import { baselineFieldLabel, baselineOptionLabel } from "./dimensionLabels";

/**
 * Validated numeric baseline input (temperature / top_p). Commits only
 * finite in-range values as canonical number strings; anything else keeps
 * the draft visible with an inline error and never reaches the baseline
 * state (the backend re-validates the same range and answers 422).
 */
function BaselineNumberField({
  value,
  min,
  max,
  disabled,
  ariaLabel,
  invalidMessage,
  onCommit,
}: {
  value: string;
  min: number;
  max: number;
  disabled: boolean;
  ariaLabel: string;
  invalidMessage: string;
  onCommit: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText(value);
    setError(null);
  }, [value]);

  const commit = () => {
    const trimmed = text.trim();
    const parsed = trimmed === "" ? NaN : Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      setError(invalidMessage);
      return;
    }
    setError(null);
    const canonical = String(parsed);
    if (canonical !== value) onCommit(canonical);
    else setText(value);
  };

  return (
    <div className="w-full">
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        className="form-input !h-auto !py-1.5 !text-[12px] disabled:cursor-not-allowed"
        disabled={disabled}
        value={text}
        aria-label={ariaLabel}
        aria-invalid={error !== null}
        onChange={(event) => {
          setText(event.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          if (event.key === "Escape") {
            setText(value);
            setError(null);
            (event.target as HTMLInputElement).blur();
          }
        }}
      />
      {error !== null && (
        <p role="alert" className="text-[11px] leading-snug text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Numeric control with an "unlimited" toggle (max_steps). The toggle commits the
 * "unlimited" token; turning it off restores the last committed number, or the
 * field default when the toggle was on from the start.
 */
function BaselineUnlimitedControl({
  value,
  fieldLabel,
  min,
  max,
  disabled,
  fallbackNumeric,
  onCommit,
}: {
  value: string;
  /** Display name of the baseline field (aria text only; the parent renders the visible <label>). */
  fieldLabel: string;
  min: number;
  max: number;
  disabled: boolean;
  fallbackNumeric: string;
  onCommit: (value: string) => void;
}) {
  const t = useT();
  const unlimited = value === "unlimited";
  const [lastNumeric, setLastNumeric] = useState(() => (unlimited ? "" : value));
  return (
    <span className="flex w-full items-start gap-1.5">
      <span className="min-w-0 flex-1">
        <BaselineNumberField
          value={unlimited ? lastNumeric : value}
          min={min}
          max={max}
          disabled={disabled || unlimited}
          ariaLabel={t("arena.setup.baselineFieldAria", { label: fieldLabel })}
          invalidMessage={t("arena.setup.baselineNumberInvalid", { min: String(min), max: String(max) })}
          onCommit={(next) => {
            setLastNumeric(next);
            onCommit(next);
          }}
        />
      </span>
      <button
        type="button"
        className="chip-toggle shrink-0"
        disabled={disabled}
        aria-pressed={unlimited}
        aria-label={t("arena.setup.baselineUnlimited")}
        title={t("arena.setup.baselineUnlimited")}
        onClick={() => {
          if (!unlimited) {
            setLastNumeric(value);
            onCommit("unlimited");
          } else {
            const restore = lastNumeric !== "" ? lastNumeric : fallbackNumeric;
            setLastNumeric(restore);
            onCommit(restore);
          }
        }}
      >
        {t("arena.setup.baselineUnlimited")}
      </button>
    </span>
  );
}

export interface BaselineModalProps {
  open: boolean;
  onClose: () => void;
  running: boolean;
  meta: ArenaMeta | null;
  dimension: DimensionId;
  baseline: BaselineOverrides;
  onBaselineFieldChange: (field: string, value: string) => void;
  showPromptBanner: boolean;
  onDismissPromptBanner: () => void;
}

/** Modal dialog hosting the controlled-variable baseline form and its context banners. */
export function BaselineModal({
  open,
  onClose,
  running,
  meta,
  dimension,
  baseline,
  onBaselineFieldChange,
  showPromptBanner,
  onDismissPromptBanner,
}: BaselineModalProps) {
  const t = useT();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Move focus into the dialog so keyboard users start inside it
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      // aria-modal="true": Tab must cycle inside the dialog, never reach the
      // dimmed background behind the backdrop.
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
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        className="arena-modal-backdrop"
        aria-label={t("arena.drawer.closeSideAria")}
        onClick={onClose}
        tabIndex={-1}
      />
      <div
        ref={dialogRef}
        className="arena-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("arena.setup.baselineTitle")}
        tabIndex={-1}
      >
        <div className="arena-modal-head">
          <p className="arena-modal-title">{t("arena.setup.baselineTitle")}</p>
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">{t("arena.setup.baselineHint")}</span>
          <button
            type="button"
            className="btn-ghost !h-7 !w-7 !p-0"
            onClick={onClose}
            aria-label={t("arena.setup.baselineCloseAria")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="arena-modal-body">
          <div className="arena-config-dense">
            {dimension === "model" && meta && meta.model_compare_ready === false && (
              <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-warning/40 bg-warning/10 px-3 py-2 text-[11px]">
                <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                <p className="flex-1 leading-relaxed text-muted-foreground">
                  {t("arena.setup.modelNotReadyPrefix")}{" "}
                  <a href="/settings" className="text-primary underline-offset-2 hover:underline">
                    {t("arena.setup.settingsLink")}
                  </a>{" "}
                  {t("arena.setup.modelNotReadySuffix")}
                </p>
              </div>
            )}

            {meta?.baseline_fields && meta.baseline_fields.length > 0 && (
              <div className="baseline-row">
                <div className="baseline-groups">
                  {BASELINE_GROUP_ORDER.map((g) => {
                    const items = meta.baseline_fields!.filter((f) => (f.group || "pipeline") === g);
                    if (items.length === 0) return null;
                    return (
                      <div key={g} className="baseline-group" data-group={g}>
                        <p className="baseline-group-title">{t(`arena.group.${g}`)}</p>
                        <div className="baseline-pick">
                          {items.map((field) => {
                            const locked = field.dimension === dimension;
                            const value = (baseline[field.field as keyof BaselineOverrides] ?? field.default) as string;
                            const fieldLab = baselineFieldLabel(t, field.field, field.label);
                            // Numeric editor only for unlocked number-kind fields with a
                            // server-provided range (old backends omit input/min/max and
                            // keep the dropdown); locked comparison fields stay selects
                            // because dimension routing needs option tokens.
                            const numeric =
                              !locked &&
                              field.input === "number" &&
                              typeof field.min === "number" &&
                              typeof field.max === "number";
                            const allowUnlimited = numeric && field.allow_unlimited === true;
                            // Shared props for both numeric editors (the unlimited variant
                            // wraps the plain field, so they take the same metadata).
                            const numericEditor = {
                              fieldLabel: fieldLab,
                              min: field.min as number,
                              max: field.max as number,
                              disabled: running,
                              ariaLabel: t("arena.setup.baselineFieldAria", { label: fieldLab }),
                              invalidMessage: t("arena.setup.baselineNumberInvalid", {
                                min: String(field.min),
                                max: String(field.max),
                              }),
                              onCommit: (next: string) => onBaselineFieldChange(field.field, next),
                            };
                            return (
                              <label
                                key={field.field}
                                className="baseline-field"
                                data-locked={locked}
                                title={locked ? t("arena.setup.lockedFieldTitle") : undefined}
                              >
                                <span className="baseline-field-label">
                                  {fieldLab}
                                  {locked ? t("arena.setup.lockedSuffix") : ""}
                                </span>
                                {numeric ? (
                                  allowUnlimited ? (
                                    <BaselineUnlimitedControl value={value} {...numericEditor} fallbackNumeric={field.default} />
                                  ) : (
                                    <BaselineNumberField value={value} {...numericEditor} />
                                  )
                                ) : (
                                  <UiSelect
                                    className="ui-select-sm w-full"
                                    disabled={locked || running}
                                    value={value}
                                    onChange={(next) => onBaselineFieldChange(field.field, next)}
                                    ariaLabel={t("arena.setup.baselineFieldAria", { label: fieldLab })}
                                    options={field.options.map((opt) => ({
                                      value: opt.value,
                                      label: baselineOptionLabel(t, field.field, opt.value, opt.label),
                                    }))}
                                  />
                                )}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {dimension === "prompt" && showPromptBanner && (
              <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-border bg-muted/20 px-3 py-2 text-[11px]">
                <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <p className="flex-1 leading-relaxed text-muted-foreground">{t("arena.setup.promptBanner")}</p>
                <button
                  type="button"
                  className="btn-ghost !h-6 !px-1.5 shrink-0"
                  onClick={onDismissPromptBanner}
                  aria-label={t("arena.setup.dismissBannerAria")}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
