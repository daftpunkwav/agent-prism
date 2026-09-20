/**
 * @file DecodeDefaultsSection
 * @description The settings page's shared decode-defaults form section.
 *
 * Responsibilities:
 * - Render the decode-defaults controls reused across settings
 */

"use client";

import { DECODE_FIELD_RANGES } from "@agentprism/client";
import { useT } from "@/i18n/useT";
import type { SettingsForm } from "./settingsConnectionModel";
import { Field } from "./Field";

interface DecodeDefaultsSectionProps {
  form: SettingsForm;
  onChange(patch: Partial<SettingsForm>): void;
}

/**
 * Decode-default editors bound to the settings form.
 *
 * @param form Settings form state.
 * @param onChange Partial-form patch handler.
 */
export function DecodeDefaultsSection({ form, onChange }: DecodeDefaultsSectionProps) {
  const t = useT();
  return (
    <>
      <div className="spectrum-line-soft my-1" aria-hidden />
      <p className="eyebrow">{t("settings.decode.title")}</p>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {t("settings.decode.desc")}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
        <Field label="Temperature">
          <input
            className="form-input"
            type="number"
            step={DECODE_FIELD_RANGES.temperature.step}
            min={DECODE_FIELD_RANGES.temperature.min}
            max={DECODE_FIELD_RANGES.temperature.max}
            value={form.temperature}
            onChange={(e) => onChange({ temperature: parseFloat(e.target.value) || 0 })}
          />
        </Field>
        <Field label="Top P">
          <input
            className="form-input"
            type="number"
            step={DECODE_FIELD_RANGES.top_p.step}
            min={DECODE_FIELD_RANGES.top_p.min}
            max={DECODE_FIELD_RANGES.top_p.max}
            value={form.top_p}
            onChange={(e) => onChange({ top_p: parseFloat(e.target.value) || 0 })}
          />
        </Field>
        <Field label={t("settings.decode.maxOutput")}>
          <input
            className="form-input font-mono text-sm"
            type="number"
            step={DECODE_FIELD_RANGES.max_output_tokens.step}
            min={DECODE_FIELD_RANGES.max_output_tokens.min}
            max={DECODE_FIELD_RANGES.max_output_tokens.max}
            value={form.max_output_tokens}
            onChange={(e) => onChange({ max_output_tokens: parseInt(e.target.value, 10) || 0 })}
          />
        </Field>
      </div>

      <details className="rounded-[var(--radius-sm)] border border-border bg-muted/10 p-3">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
          {t("settings.decode.notes")}
        </summary>
        <div className="mt-3">
          <input
            className="form-input"
            placeholder={t("settings.decode.notesPlaceholder")}
            value={form.notes}
            onChange={(e) => onChange({ notes: e.target.value })}
          />
        </div>
      </details>
    </>
  );
}
