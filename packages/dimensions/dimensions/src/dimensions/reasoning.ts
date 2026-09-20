/**
 * @file dimensions/reasoning
 * @description Options for the reasoning-mode dimension.
 *
 * Responsibilities:
 * - Derive REASONING_OPTIONS from the contracts metadata single source
 */

import { REASONING_MODE_META } from "@agentprism/contracts";
import type { DimensionOptionTriple } from "../fields.js";

export const REASONING_OPTIONS: DimensionOptionTriple[] = REASONING_MODE_META.map((spec) => ({
  field: "reasoning",
  value: spec.mode,
  label: spec.label,
}));
