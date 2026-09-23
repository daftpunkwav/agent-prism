/**
 * @file dimensions/history-mode
 * @description Static options for the cross-turn history mode dimension.
 *
 * Responsibilities:
 * - Export HISTORY_MODE_OPTIONS consumed by the dimension catalog
 */

import type { DimensionOptionTriple } from "../fields.js";

export const HISTORY_MODE_OPTIONS: DimensionOptionTriple[] = [
  { field: "history_mode", value: "minimal", label: "Minimal (bare Q/A pairs)" },
  { field: "history_mode", value: "tool_summary", label: "Tool summary (one line per tool call)" },
  { field: "history_mode", value: "full", label: "Full (args + tool results)" },
];
