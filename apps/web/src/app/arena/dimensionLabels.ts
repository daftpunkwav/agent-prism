/**
 * @file dimensionLabels
 * @description Display overlay mapping dimension ids/values to locale catalogs.
 *
 * Responsibilities:
 * - Localize field, option, and baseline labels
 * - Keep API/pipeline labels in English as stable aggregation keys
 */

import type { MessageKey } from "@/i18n/catalogs/types";
import type { useT } from "@/i18n/useT";

type TFn = ReturnType<typeof useT>;

/** Config field → dimension id for option-key lookup (baseline-only fields omitted). */
const FIELD_TO_DIMENSION: Record<string, string> = {
  framework: "framework",
  prompt_profile: "prompt",
  reasoning: "reasoning",
  context: "context",
  harness: "harness",
  temperature: "temperature",
  endpoint_id: "model",
  thinking_level: "thinking",
  max_steps: "max_steps",
  toolset: "toolset",
  mcp_policy: "mcp",
  skill_policy: "skill",
  orchestration: "orchestration",
  memory: "memory",
  history_mode: "history_mode",
};

/** Baseline-only fields (no dimension id) with translatable option labels. */
const BASELINE_ONLY_OPTION_FIELDS = new Set(["approval_mode", "sandbox_mode"]);

/** English canonical suffix emitted by packages/dimensions currentEndpointLabel. */
export const CANONICAL_CURRENT_SUFFIX = " (current)";

/** Resolves a catalog key; falls back when the entry is missing (⟦ marker) or untranslated. */
export function catalogOrFallback(t: TFn, key: MessageKey, fallback: string): string {
  const resolved = t(key);
  if (resolved.startsWith("⟦") || resolved === key) return fallback;
  return resolved;
}

/** Dimension card / select label. */
export function dimFieldLabel(t: TFn, dimensionId: string, fallback: string): string {
  return catalogOrFallback(t, `dimensions.field.${dimensionId}` as MessageKey, fallback);
}

/** Dimension card subtitle. */
export function dimSubtitle(t: TFn, dimensionId: string, fallback: string): string {
  return catalogOrFallback(t, `dimensions.subtitle.${dimensionId}` as MessageKey, fallback);
}

/** Baseline panel field label (config field name). */
export function baselineFieldLabel(t: TFn, field: string, fallback: string): string {
  return catalogOrFallback(t, `dimensions.baselineField.${field}` as MessageKey, fallback);
}

/** Localize the default-endpoint "(current)" suffix; leave other labels untouched. */
export function localizeCurrentSuffix(t: TFn, label: string): string {
  if (!label.endsWith(CANONICAL_CURRENT_SUFFIX)) return label;
  const base = label.slice(0, -CANONICAL_CURRENT_SUFFIX.length);
  return `${base}${t("dimensions.currentSuffix")}`;
}

/**
 * Option display label for a known dimension.
 * Model options are dynamic (endpoint names) — only the current-suffix is localized.
 * Temperature option keys use underscores (0_3) because catalog paths cannot embed dots.
 */
export function dimOptionLabel(
  t: TFn,
  dimensionId: string,
  value: string,
  fallback: string,
): string {
  if (dimensionId === "model") return localizeCurrentSuffix(t, fallback);
  const catalogValue = dimensionId === "temperature" ? value.replaceAll(".", "_") : value;
  return catalogOrFallback(
    t,
    `dimensions.opt.${dimensionId}.${catalogValue}` as MessageKey,
    fallback,
  );
}

/** Baseline option label: resolve via field→dimension map when possible, then via the baseline-only option map. */
export function baselineOptionLabel(
  t: TFn,
  field: string,
  value: string,
  fallback: string,
): string {
  const dimensionId = FIELD_TO_DIMENSION[field];
  if (dimensionId !== undefined) return dimOptionLabel(t, dimensionId, value, fallback);
  if (BASELINE_ONLY_OPTION_FIELDS.has(field)) {
    return catalogOrFallback(t, `dimensions.baselineOpt.${field}.${value}` as MessageKey, fallback);
  }
  return fallback;
}

/** Map a pipeline aggregation label back to a display label using the active dimension options. */
export function pipelineDisplayLabel(
  t: TFn,
  dimensionId: string,
  pipelineLabel: string,
  options: Array<{ value: string; label: string }>,
): string {
  const match = options.find((o) => o.label === pipelineLabel);
  if (match) return dimOptionLabel(t, dimensionId, match.value, match.label);
  return localizeCurrentSuffix(t, pipelineLabel);
}
