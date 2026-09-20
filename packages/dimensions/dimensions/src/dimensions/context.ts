/**
 * @file dimensions/context
 * @description Static options for the context/memory dimension.
 *
 * Responsibilities:
 * - Export CONTEXT_OPTIONS consumed by the dimension catalog
 */

import type { DimensionOptionTriple } from "../fields.js";

export const CONTEXT_OPTIONS: DimensionOptionTriple[] = [
  { field: "context", value: "sliding", label: "Sliding window" },
  { field: "context", value: "summary", label: "Summary compression" },
  { field: "context", value: "vector", label: "Vector retrieval" },
  { field: "context", value: "hybrid", label: "Hybrid strategy" },
  { field: "context", value: "tool_tail", label: "Tool-tail pruning" },
  { field: "context", value: "token_budget", label: "Token-budget fit" },
  { field: "context", value: "budget", label: "Source budget" },
  { field: "context", value: "checkpoint", label: "Checkpoint compaction" },
];
