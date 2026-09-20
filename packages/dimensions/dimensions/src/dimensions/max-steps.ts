/**
 * @file dimensions/max-steps
 * @description Static options for the max-steps dimension.
 *
 * Responsibilities:
 * - Export MAX_STEPS_OPTIONS consumed by the dimension catalog
 */

import type { DimensionOptionTriple } from "../fields.js";

export const MAX_STEPS_OPTIONS: DimensionOptionTriple[] = [
  { field: "max_steps", value: "5", label: "5 steps" },
  { field: "max_steps", value: "10", label: "10 steps" },
  { field: "max_steps", value: "15", label: "15 steps" },
  { field: "max_steps", value: "20", label: "20 steps" },
];
