/**
 * @file dimensions/skill
 * @description Static options for the skill loading dimension.
 *
 * Responsibilities:
 * - Export SKILL_POLICY_OPTIONS consumed by the dimension catalog
 */

import type { DimensionOptionTriple } from "../fields.js";

export const SKILL_POLICY_OPTIONS: DimensionOptionTriple[] = [
  { field: "skill_policy", value: "off", label: "Skills disabled" },
  { field: "skill_policy", value: "on_demand", label: "On-demand via skill tool" },
  { field: "skill_policy", value: "preloaded", label: "Preloaded into prompt" },
];
