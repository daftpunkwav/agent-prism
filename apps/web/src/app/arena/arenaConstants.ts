/**
 * @file arenaConstants
 * @description Arena page constants: group order and catalog-key mappings.
 *
 * Responsibilities:
 * - Re-export dimension mappings and baseline group ordering
 *
 * No visible strings live here; labels resolve via the i18n catalog at render.
 */

import { DIMENSION_FIELD, DIMENSION_IDS } from "@agentprism/client";

/** Dimension mapping: contract single source (contracts/dimension-field) consumed via the client outlet; the frontend no longer maintains its own. */
export { DIMENSION_FIELD, DIMENSION_IDS };

/** Baseline group display order (backend meta only guarantees membership; this frontend single source decides order). */
export const BASELINE_GROUP_ORDER = ["pipeline", "decode", "access"] as const;

export type MainTab = "results" | "report" | "diff" | "logs" | "matrix";

