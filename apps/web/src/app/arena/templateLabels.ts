/**
 * @file templateLabels
 * @description Display overlay mapping task-template ids to locale catalogs.
 *
 * Responsibilities:
 * - Localize template display names and suggested questions
 * - Fall back to the backend's canonical English text when a key is absent
 *
 * Backend task-templates stay locale-free and remain the single source for what
 * is actually sent to the models; these overlays only shape what the UI shows.
 */

import type { MessageKey } from "@/i18n/catalogs/types";
import type { useT } from "@/i18n/useT";
import { catalogOrFallback } from "./dimensionLabels";

type TFn = ReturnType<typeof useT>;

/** Localized display name for a task template (falls back to the backend name). */
export function templateName(t: TFn, templateId: string, fallback: string): string {
  return catalogOrFallback(t, `arena.templates.${templateId}.name` as MessageKey, fallback);
}

/** Localized suggested question for a task template (falls back to the backend question). */
export function templateQuestion(t: TFn, templateId: string, fallback: string): string {
  return catalogOrFallback(t, `arena.templates.${templateId}.question` as MessageKey, fallback);
}
