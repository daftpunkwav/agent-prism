/**
 * @file dimensions/harness
 * @description Static options for the harness/verification dimension.
 *
 * Responsibilities:
 * - Export HARNESS_OPTIONS consumed by the dimension catalog
 */

import type { DimensionOptionTriple } from "../fields.js";

export const HARNESS_OPTIONS: DimensionOptionTriple[] = [
  { field: "harness", value: "bare", label: "Bare run" },
  { field: "harness", value: "verify", label: "Verify loop" },
  { field: "harness", value: "reflect", label: "Reflect loop" },
  { field: "harness", value: "self_evolve", label: "Self-evolve" },
];
