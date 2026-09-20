/**
 * @file dimensions/orchestration
 * @description Static options for the orchestration discipline dimension.
 *
 * Responsibilities:
 * - Export ORCHESTRATION_OPTIONS consumed by the dimension catalog
 */

import type { DimensionOptionTriple } from "../fields.js";

export const ORCHESTRATION_OPTIONS: DimensionOptionTriple[] = [
  { field: "orchestration", value: "direct", label: "Direct execution" },
  { field: "orchestration", value: "plan_first", label: "Plan-first (plan tool up front)" },
  { field: "orchestration", value: "goal_first", label: "Goal-first (goal tool up front)" },
];
