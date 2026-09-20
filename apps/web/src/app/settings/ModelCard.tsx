/**
 * @file ModelCard
 * @description Collapsible card editing one model slot inside a connection group.
 *
 * Responsibilities:
 * - Edit a single model slot's fields
 */

"use client";

import { ChevronDown, ChevronRight, Star, Trash2 } from "lucide-react";
import { UiSelect } from "@agentprism/ui";
import { useT } from "@/i18n/useT";
import type { ModelSlot } from "./settingsConnectionModel";
import { Field } from "./Field";

interface ModelCardProps {
  model: ModelSlot;
  index: number;
  isDefault: boolean;
  expanded: boolean;
  onToggleExpand(): void;
  onUpdate(patch: Partial<ModelSlot>): void;
  onSetDefault(): void;
  onDelete(): void;
  canDelete: boolean;
}

/** One model slot editor inside a connection card (params, default flag, delete guard). */
export function ModelCard({
  model: m,
  index: mi,
  isDefault,
  expanded: open,
  onToggleExpand,
  onUpdate,
  onSetDefault,
  onDelete,
  canDelete,
}: ModelCardProps) {
  const t = useT();
  const levelLab =
    m.thinking_level === "low"
      ? t("settings.model.levelLow")
      : m.thinking_level === "medium"
        ? t("settings.model.levelMedium")
        : m.thinking_level === "high"
          ? t("settings.model.levelHigh")
          : t("settings.model.levelOffShort");

  return (
    <div
      className={
        "rounded-[var(--radius-sm)] border " +
        (isDefault ? "border-primary/40 bg-background/60" : "border-border/80 bg-background/40")
      }
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button
          type="button"
          className="btn-ghost !h-7 !w-7 !p-0 shrink-0"
          aria-expanded={open}
          aria-label={open ? t("settings.model.collapseAria") : t("settings.model.expandAria")}
          onClick={onToggleExpand}
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            className="form-input !h-8 text-sm"
            value={m.label}
            placeholder={t("settings.model.labelPlaceholder")}
            aria-label={t("settings.model.labelAria", { index: mi + 1 })}
            onChange={(e) => onUpdate({ label: e.target.value })}
          />
          <input
            className="form-input !h-8 font-mono text-sm"
            value={m.model}
            required
            placeholder="model id"
            aria-label={t("settings.model.modelIdAria", { index: mi + 1 })}
            onChange={(e) => onUpdate({ model: e.target.value })}
          />
        </div>
        <span className="text-[11px] font-mono text-muted-foreground shrink-0">
          {m.thinking_capable
            ? t("settings.model.thinkingLevelShort", { level: levelLab })
            : t("settings.model.noThinking")}
          {isDefault ? t("settings.model.defaultBadge") : ""}
        </span>
        <button
          type="button"
          className="btn-ghost !h-7 !px-2 text-[11px]"
          title={t("settings.model.setDefaultTitle")}
          aria-label={t("settings.model.setDefaultTitle")}
          aria-pressed={isDefault}
          onClick={onSetDefault}
        >
          <Star className={"h-3 w-3 " + (isDefault ? "fill-current" : "")} />
        </button>
        <button
          type="button"
          className="btn-ghost !h-7 !w-7 !p-0"
          disabled={!canDelete}
          onClick={onDelete}
          aria-label={t("settings.model.deleteAria")}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {open && (
        <div className="border-t border-border/60 px-3 py-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
            <Field label={t("settings.model.contextWindow")}>
              <input
                className="form-input font-mono text-sm"
                type="number"
                min={1024}
                value={m.context_window}
                onChange={(e) => onUpdate({ context_window: parseInt(e.target.value, 10) || 0 })}
              />
            </Field>
            <Field label={t("settings.model.maxInput")}>
              <input
                className="form-input font-mono text-sm"
                type="number"
                min={256}
                value={m.max_input_tokens}
                onChange={(e) => onUpdate({ max_input_tokens: parseInt(e.target.value, 10) || 0 })}
              />
            </Field>
            <Field label={t("settings.model.maxOutput")}>
              <input
                className="form-input font-mono text-sm"
                type="number"
                min={64}
                value={m.max_output_tokens}
                onChange={(e) => onUpdate({ max_output_tokens: parseInt(e.target.value, 10) || 0 })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                className="accent-[var(--primary)]"
                checked={m.image_input}
                onChange={(e) => onUpdate({ image_input: e.target.checked })}
              />
              {t("settings.model.imageInput")}
            </label>
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                className="accent-[var(--primary)]"
                checked={m.video_input}
                onChange={(e) => onUpdate({ video_input: e.target.checked })}
              />
              {t("settings.model.videoInput")}
            </label>
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                className="accent-[var(--primary)]"
                checked={m.thinking_capable}
                onChange={(e) =>
                  onUpdate({
                    thinking_capable: e.target.checked,
                    thinking_level: e.target.checked
                      ? m.thinking_level === "off"
                        ? "medium"
                        : m.thinking_level
                      : "off",
                  })
                }
              />
              {t("settings.model.thinkingCapable")}
            </label>
            <Field label={t("settings.model.defaultThinkingLevel")}>
              <UiSelect
                className="w-full"
                disabled={!m.thinking_capable}
                value={m.thinking_capable ? m.thinking_level : "off"}
                onChange={(value) => onUpdate({ thinking_level: value as ModelSlot["thinking_level"] })}
                ariaLabel={t("settings.model.defaultThinkingLevel")}
                options={[
                  { value: "off", label: t("settings.model.levelOff") },
                  { value: "low", label: t("settings.model.levelLow") },
                  { value: "medium", label: t("settings.model.levelMedium") },
                  { value: "high", label: t("settings.model.levelHigh") },
                ]}
              />
            </Field>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {t("settings.model.thinkingHint")}
          </p>
        </div>
      )}
    </div>
  );
}
