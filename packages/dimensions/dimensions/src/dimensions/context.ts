/**
 * @file dimensions/context
 * @description Static options for the context/memory dimension.
 *
 * Responsibilities:
 * - Export CONTEXT_OPTIONS consumed by the dimension catalog
 *
 * Rows must stay a subset of the harness context policy registry ids; the
 * capability projection filters unregistered ids, so extra rows here are dead.
 */

import type { DimensionOptionTriple } from "../fields.js";

export const CONTEXT_OPTIONS: DimensionOptionTriple[] = [
  { field: "context", value: "sliding", label: "Sliding window" },
  { field: "context", value: "summary", label: "Summary compression" },
  { field: "context", value: "vector", label: "Vector retrieval" },
  { field: "context", value: "hybrid", label: "Hybrid strategy" },
  { field: "context", value: "tool_tail", label: "Tool-tail pruning" },
  { field: "context", value: "token_budget", label: "Token-budget fit" },
];
