/**
 * @file reasoning-mode-meta
 * @description Display metadata per reasoning mode (single source).
 *
 * Responsibilities:
 * - Provide label and description per reasoning mode
 */

import type { ReasoningMode } from "./enums.js";

export interface ReasoningModeMeta {
  mode: ReasoningMode;
  label: string;
  description: string;
}

/** Display metadata list per reasoning mode. The harness layer appends systemSuffix/userSuffix on top of this. */
export const REASONING_MODE_META: readonly ReasoningModeMeta[] = [
  { mode: "react", label: "ReAct", description: "ReAct loop" },
  { mode: "cot_tool", label: "CoT+Tool", description: "CoT+Tool two-phase" },
  { mode: "tot", label: "ToT", description: "ToT candidate evaluation" },
  { mode: "reflexion", label: "Reflexion", description: "Reflexion critique" },
  { mode: "self_consistency", label: "Self-Consistency", description: "N sampled attempts, majority vote" },
];
