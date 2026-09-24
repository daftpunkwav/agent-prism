/**
 * @file dimension-field
 * @description Comparison dimension to PipelineConfig field mapping (single source).
 *
 * Responsibilities:
 * - Map each dimension id to its PipelineConfig field name
 *
 * Backend baseline absorption and the frontend baseline payload both derive
 * from this file; neither side maintains its own table.
 */

import { DimensionIdSchema } from "./enums.js";
import type { DimensionId } from "./enums.js";

export const DIMENSION_FIELD: Record<DimensionId, string> = {
  framework: "framework",
  prompt: "prompt_profile",
  reasoning: "reasoning",
  context: "context",
  harness: "harness",
  temperature: "temperature",
  model: "endpoint_id",
  thinking: "thinking_level",
  thinking_budget: "thinking_budget",
  max_steps: "max_steps",
  toolset: "toolset",
  mcp: "mcp_policy",
  skill: "skill_policy",
  orchestration: "orchestration",
  memory: "memory",
  history_mode: "history_mode",
};

/** All dimension ids (derived from the zod schema, guaranteed same-source with the enum). */
export const DIMENSION_IDS: readonly DimensionId[] = [...DimensionIdSchema.options];
