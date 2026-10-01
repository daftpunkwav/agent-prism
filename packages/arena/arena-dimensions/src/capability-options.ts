/**
 * @file capability-options
 * @description Projects the registered capability ids onto dimension option triples.
 *
 * Responsibilities:
 * - Map registered prompt/reasoning/context/harness ids to option entries for GET /api/arena/meta
 * - Project each registered custom dimension onto a comparison axis of its own
 *
 * Labels come from the dimensions static catalogs. Membership is live-registry gated for
 * prompt/context/harness/reasoning (prompt section registry, context policy registry);
 * toolset lists every toolset the tools package supports (toolset availability is static,
 * not registry-gated).
 */

import { REASONING_MODE_META, TOOL_NAMES_BY_TOOLSET } from "@agentprism/contracts";
import {
  CONTEXT_OPTIONS,
  HARNESS_OPTIONS,
  PROMPT_OPTIONS,
  TOOLSET_OPTIONS,
  type DimensionOptionTriple,
} from "@agentprism/dimensions";
import { createBuiltinContextPolicyRegistry, getBuiltinPromptSectionRegistry } from "@agentprism/harness";
import { listCustomDimensionRows } from "./custom-dimension-rows.js";

function idsWithPrefix(allIds: string[], prefix: string): Set<string> {
  const out = new Set<string>();
  for (const id of allIds) {
    if (id.startsWith(prefix)) out.add(id.slice(prefix.length));
  }
  return out;
}

function project(catalog: DimensionOptionTriple[], registered: Set<string>): DimensionOptionTriple[] {
  return catalog.filter((option) => registered.has(option.value)).map((option) => ({ ...option }));
}

/**
 * Option rows of every registered custom dimension, keyed by its own dimension
 * id. Built on the arena row projection, so the synthetic field name and the
 * option triple shape stay single-sourced across /meta, the baseline panel and
 * this capability projection.
 */
function customDimensionOptions(): Record<string, DimensionOptionTriple[]> {
  return Object.fromEntries(listCustomDimensionRows().map((row) => [row.id, row.options]));
}

/**
 * Builds capability dimension options from the currently registered sources.
 * Keys are builtin dimension ids plus every registered custom dimension id, so
 * the map is a plain string-keyed record over the live registry.
 */
export function buildCapabilityOptionProjection(
  options: { customDimensions?: boolean } = {},
): Partial<Record<string, DimensionOptionTriple[]>> {
  const sectionIds = getBuiltinPromptSectionRegistry().listIds();
  const contextRegistered = new Set(createBuiltinContextPolicyRegistry().listIds());
  const reasoningFromSections = idsWithPrefix(sectionIds, "reasoning:");
  const reasoningRegistered = new Set(
    REASONING_MODE_META.map((meta) => meta.mode).filter((mode) => reasoningFromSections.has(mode)),
  );
  const toolsetRegistered = new Set(Object.keys(TOOL_NAMES_BY_TOOLSET));
  // The composition root passes the settings switch. Omitted means on, which is
  // the historical default when ARENA_CUSTOM_DIMENSIONS is unset.
  const customEnabled = options.customDimensions !== false;

  return {
    prompt: project(PROMPT_OPTIONS, idsWithPrefix(sectionIds, "profile:")),
    context: project(CONTEXT_OPTIONS, contextRegistered),
    harness: project(HARNESS_OPTIONS, idsWithPrefix(sectionIds, "harness:")),
    reasoning: REASONING_MODE_META.filter((meta) => reasoningRegistered.has(meta.mode)).map(
      (meta): DimensionOptionTriple => ({
        field: "reasoning",
        value: meta.mode,
        label: meta.label,
      }),
    ),
    toolset: project(TOOLSET_OPTIONS, toolsetRegistered),
    ...(customEnabled ? customDimensionOptions() : {}),
  };
}
