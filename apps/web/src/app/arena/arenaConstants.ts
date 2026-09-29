/**
 * @file arenaConstants
 * @description Arena page constants: group order and catalog-key mappings.
 *
 * Responsibilities:
 * - Re-export dimension mappings and baseline group ordering
 * - Declare the baseline draft shape the arena panel edits
 * - Normalize the effective thinking mode against the served baseline options
 *
 * No visible strings live here; labels resolve via the i18n catalog at render.
 */

import { DIMENSION_FIELD, DIMENSION_IDS } from "@agentprism/client";
import type { ArenaMeta } from "@agentprism/client";

/** Dimension mapping: contract single source (contracts/dimension-field) consumed via the client outlet; the frontend no longer maintains its own. */
export { DIMENSION_FIELD, DIMENSION_IDS };

/** Baseline group display order (backend meta only guarantees membership; this frontend single source decides order). */
export const BASELINE_GROUP_ORDER = ["pipeline", "decode", "access"] as const;

/**
 * Baseline draft: flat `field → token` map keyed by the served baseline field
 * names, exactly the keys `baseline_defaults` / `baseline_fields[].field` carry (a
 * custom dimension appears as `custom.<id>`). This is the panel's editing shape,
 * not the run-request shape: useArenaConfig's baselinePayload nests the custom
 * entries into `BaselineOverrides.custom` on the way out.
 */
export type BaselineDraft = Record<string, string>;

/**
 * The thinking mode actually in effect: the stored draft wins, but only when
 * the server still offers it. The served option set follows the default
 * endpoint's capability (budget pairs exist on anthropic_messages endpoints
 * only), so a draft kept from an earlier endpoint falls back to level mapping
 * instead of rendering a dead budget tab and shipping a mode the server would
 * reject or silently downgrade.
 */
export function effectiveThinkingMode(meta: ArenaMeta | null, baseline: BaselineDraft): "levels" | "budget" {
  // Without the served option set there is nothing to vouch for the draft's
  // budget pin, so level mapping is the only safe answer (meta is always
  // loaded before a run can be assembled).
  const served = meta?.baseline_fields.find((field) => field.field === "thinking_mode");
  if (!served || served.options.length === 0) return "levels";
  const raw = baseline["thinking_mode"] ?? meta?.baseline_defaults?.["thinking_mode"] ?? "levels";
  if (!served.options.some((option) => option.value === raw)) return "levels";
  return raw === "budget" ? "budget" : "levels";
}

export type MainTab = "results" | "report" | "diff" | "logs" | "matrix";

