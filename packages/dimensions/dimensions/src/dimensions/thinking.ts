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

/** Anthropic budget_tokens seeds (numeric free input is legal on top); 0 follows the level. */
export const THINKING_BUDGET_OPTIONS: DimensionOptionTriple[] = [
  { field: "thinking_budget", value: "0", label: "0 (follow level)" },
  { field: "thinking_budget", value: "2048", label: "2048" },
  { field: "thinking_budget", value: "8192", label: "8192" },
  { field: "thinking_budget", value: "16384", label: "16384" },
  { field: "thinking_budget", value: "32768", label: "32768" },
  { field: "thinking_budget", value: "65536", label: "65536" },
];
