/**
 * @file dimensions/thinking
 * @description Static options for the thinking-level dimension.
 *
 * Responsibilities:
 * - Export THINKING_OPTIONS consumed by the dimension catalog
 */

import type { DimensionOptionTriple } from "../fields.js";

export const THINKING_OPTIONS: DimensionOptionTriple[] = [
  { field: "thinking_level", value: "off", label: "Off" },
  { field: "thinking_level", value: "low", label: "Low" },
  { field: "thinking_level", value: "medium", label: "Medium" },
  { field: "thinking_level", value: "high", label: "High" },
];
