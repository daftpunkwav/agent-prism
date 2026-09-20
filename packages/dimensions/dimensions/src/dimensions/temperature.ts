/**
 * @file dimensions/temperature
 * @description Static options for the temperature dimension.
 *
 * Responsibilities:
 * - Export TEMPERATURE_OPTIONS consumed by the dimension catalog
 */

import type { DimensionOptionTriple } from "../fields.js";

export const TEMPERATURE_OPTIONS: DimensionOptionTriple[] = [
  { field: "temperature", value: "0", label: "0 (deterministic)" },
  { field: "temperature", value: "0.3", label: "0.3" },
  { field: "temperature", value: "0.7", label: "0.7" },
  { field: "temperature", value: "1", label: "1.0" },
];
