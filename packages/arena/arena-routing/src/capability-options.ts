/**
 * @file capability-options
 * @description Projects registered capability plugins onto dimension option triples.
 *
 * Responsibilities:
 * - Map plugin ids to option entries for GET /api/arena/meta
 *
 * Labels come from the dimensions static catalogs. Membership is live-registry gated for
 * prompt/context/harness/reasoning; toolset lists every toolset the tools package supports
 * (toolset availability is static, not plugin-registered).
 */

import type { DimensionId } from "@agentprism/contracts";
import { REASONING_MODE_META, TOOL_NAMES_BY_TOOLSET } from "@agentprism/contracts";
import {
  CONTEXT_OPTIONS,
  HARNESS_OPTIONS,
  PROMPT_OPTIONS,
  TOOLSET_OPTIONS,
  type DimensionOptionTriple,
} from "@agentprism/dimensions";
import {
  createBuiltinContextPolicyRegistry,
  listContextStrategyPlugins,
  getBuiltinPromptSectionRegistry,
} from "@agentprism/harness";

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

/** Builds capability dimension options from currently registered plugins. */
export function buildCapabilityOptionProjection(): Partial<Record<DimensionId, DimensionOptionTriple[]>> {
  const sectionIds = getBuiltinPromptSectionRegistry().listIds();
  const contextRegistered = new Set(createBuiltinContextPolicyRegistry().listIds());
  const reasoningFromSections = idsWithPrefix(sectionIds, "reasoning:");
  const reasoningRegistered = new Set(
    REASONING_MODE_META.map((meta) => meta.mode).filter((mode) => reasoningFromSections.has(mode)),
  );
  const toolsetRegistered = new Set(Object.keys(TOOL_NAMES_BY_TOOLSET));
  // Custom-dimension subpackages: registered plugins append their own labels
  // after the builtin rows; ARENA_CUSTOM_DIMENSIONS=off turns them off.
  const customEnabled = process.env.ARENA_CUSTOM_DIMENSIONS !== "off";
  const pluginRows = customEnabled
    ? listContextStrategyPlugins().map((plugin) => ({ field: "context", value: plugin.id, label: plugin.label }))
    : [];

  return {
    prompt: project(PROMPT_OPTIONS, idsWithPrefix(sectionIds, "profile:")),
    context: [...project(CONTEXT_OPTIONS, contextRegistered), ...pluginRows],
    harness: project(HARNESS_OPTIONS, idsWithPrefix(sectionIds, "harness:")),
    reasoning: REASONING_MODE_META.filter((meta) => reasoningRegistered.has(meta.mode)).map(
      (meta): DimensionOptionTriple => ({
        field: "reasoning",
        value: meta.mode,
        label: meta.label,
      }),
    ),
    toolset: project(TOOLSET_OPTIONS, toolsetRegistered),
  };
}
