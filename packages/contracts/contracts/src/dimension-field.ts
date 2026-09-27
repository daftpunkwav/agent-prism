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
import { customFieldKey } from "./custom-dimension.js";

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

/**
 * Field name of any comparison dimension. Builtin ids map to their PipelineConfig
 * field; a registered custom dimension maps to the synthetic `custom.<id>` field
 * carried inside the config's `custom` record (see custom-dimension.ts). Single
 * source for the router, baseline resolution, the panel projection, and the web.
 *
 * Own-key lookup: the custom id grammar admits Object.prototype member names
 * ("constructor", "toString"), and an inherited read would return that member — a
 * function where a field name belongs — instead of the synthetic `custom.<id>`.
 */
export function dimensionFieldName(dimension: string): string {
  const builtin: string | undefined = Object.hasOwn(DIMENSION_FIELD, dimension)
    ? (DIMENSION_FIELD as Record<string, string | undefined>)[dimension]
    : undefined;
  return builtin ?? customFieldKey(dimension);
}
