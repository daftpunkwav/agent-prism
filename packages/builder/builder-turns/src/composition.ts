/**
 * @file composition
 * @description Composition blocks: normalization, validation, and run-config mapping.
 *
 * Responsibilities:
 * - Normalize and validate a BuilderComposition against available blocks
 * - Map a composition onto the shared PipelineConfig for one run
 * - Diff two compositions and produce the model-facing swap notice
 *
 * Pure module: no IO, no session state. The empty-tools composition is legal and
 * maps to a tool-free agent; validation never silently substitutes blocks.
 */

import type { PipelineConfig } from "@agentprism/contracts";
import {
  TOOL_NAMES_BY_TOOLSET,
  type BuilderComposition,
  type BuilderCompositionInput,
  type ToolsetId,
} from "@agentprism/contracts";
import { BuilderCompositionSchema, migrateLegacyToolNames } from "@agentprism/contracts";
import { BuilderError } from "./errors.js";

/** Default session tool set (contracts single source; the schema default for omitted `tools`). */
export { DEFAULT_BUILDER_TOOLS } from "@agentprism/contracts";

/** Parses raw input into a fully defaulted composition; unknown fields reject. */
export function normalizeComposition(input: BuilderCompositionInput): BuilderComposition {
  const parsed = BuilderCompositionSchema.safeParse(input);
  if (!parsed.success) {
    throw BuilderError.invalid(`Invalid composition: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`);
  }
  const composition = parsed.data;
  // Persisted pre-rename compositions carry "run"; normalize on every parse so
  // configure-time validation and tool binding see the current name.
  return { ...composition, tools: dedupe(migrateLegacyToolNames(composition.tools)) };
}

function dedupe(names: string[]): string[] {
  return [...new Set(names)];
}

/** Availability seams the validator checks against (injected, never global). */
export interface CompositionBlockIndex {
  availableFrameworks: readonly string[];
  knownTools: readonly string[];
  /** Known endpoint ids; when provided, a non-empty unknown endpoint_id rejects ("" always means the provider default). */
  knownEndpointIds?: readonly string[];
}

/** Rejects unknown framework or tool blocks with a message naming the offender. */
export function validateComposition(composition: BuilderComposition, index: CompositionBlockIndex): void {
  if (!index.availableFrameworks.includes(composition.framework)) {
    throw BuilderError.invalid(
      `Unknown framework block "${composition.framework}" (available: ${index.availableFrameworks.join(", ") || "none"})`,
    );
  }
  const known = new Set(index.knownTools);
  const unknown = composition.tools.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw BuilderError.invalid(`Unknown tool block(s): ${unknown.join(", ")}`);
  }
  // Stale endpoint ids otherwise surface only at turn time (model construction throws);
  // reject at configure time when the caller supplies the live endpoint list.
  if (
    composition.endpoint_id !== "" &&
    index.knownEndpointIds !== undefined &&
    !index.knownEndpointIds.includes(composition.endpoint_id)
  ) {
    throw BuilderError.invalid(`Unknown endpoint block "${composition.endpoint_id}" (it may have been deleted or renamed)`);
  }
}

/**
 * Maps a composition onto PipelineConfig. The toolset field only feeds display
 * banners and prompt profiles: the authoritative tool authorization travels via
 * the run's explicit tool names, so a custom subset maps to "full" as the widest
 * description base and the actual bound set is always narrower (fail-closed).
 */
export function compositionToPipelineConfig(
  composition: BuilderComposition,
  label: string,
  options: { thinkingCapable: boolean },
): PipelineConfig {
  return {
    framework: composition.framework,
    reasoning: composition.reasoning,
    context: composition.context,
    harness: composition.harness,
    prompt_profile: composition.prompt_profile,
    endpoint_id: composition.endpoint_id,
    model_id: composition.model_id,
    temperature: composition.temperature,
    top_p: composition.top_p,
    frequency_penalty: composition.frequency_penalty,
    presence_penalty: composition.presence_penalty,
    max_output_tokens: composition.max_output_tokens,
    thinking_level: composition.thinking_level,
    thinking_capable: options.thinkingCapable,
    max_steps: composition.max_steps,
    toolset: baseToolsetFor(composition.tools),
    // Comparison policies are builder-selectable blocks now (schema defaults keep
    // legacy sessions unchanged): they flow straight into the pipeline config.
    mcp_policy: composition.mcp_policy,
    skill_policy: composition.skill_policy,
    approval_mode: composition.approval_mode,
    sandbox_mode: composition.sandbox_mode,
    orchestration: composition.orchestration,
    memory: composition.memory,
    prompt_version: "v1.0.0",
    label,
  };
}

/** Returns the builtin toolset exactly matched by the selection; custom subsets fall back to "full". */
function baseToolsetFor(tools: readonly string[]): ToolsetId {
  for (const [toolset, names] of Object.entries(TOOL_NAMES_BY_TOOLSET)) {
    if (tools.length === names.length && [...names].every((name) => tools.includes(name))) {
      return toolset as ToolsetId;
    }
  }
  return "full";
}

/** Field-level diff between two compositions (tool order ignored). */
export interface CompositionDiff {
  changedFields: string[];
  toolsAdded: string[];
  toolsRemoved: string[];
}

const COMPARABLE_FIELDS = [
  "framework",
  "endpoint_id",
  "model_id",
  "temperature",
  "top_p",
  "frequency_penalty",
  "presence_penalty",
  "max_output_tokens",
  "thinking_level",
  "tools",
  "context",
  "prompt_profile",
  "reasoning",
  "harness",
  "max_steps",
  "system_prompt",
  "mcp_policy",
  "skill_policy",
  "orchestration",
  "memory",
  "approval_mode",
  "sandbox_mode",
] as const;

/**
 * Diffs two compositions for hot-swap notices (tools compared as sets, order-free).
 *
 * @param before Active composition.
 * @param after Proposed composition.
 * @returns Changed field ids plus added/removed tool names (all sorted by field order).
 */
export function diffComposition(before: BuilderComposition, after: BuilderComposition): CompositionDiff {
  const changedFields: string[] = [];
  for (const field of COMPARABLE_FIELDS) {
    if (field === "tools") {
      if (sameSet(before.tools, after.tools)) continue;
      changedFields.push(field);
      continue;
    }
    if (before[field] !== after[field]) changedFields.push(field);
  }
  return {
    changedFields,
    toolsAdded: after.tools.filter((name) => !before.tools.includes(name)),
    toolsRemoved: before.tools.filter((name) => !after.tools.includes(name)),
  };
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((name) => right.includes(name));
}

/** Builds the model-facing notice describing one hot-swap (English, injected into the system prompt). */
export function buildSwapNotice(diff: CompositionDiff, after: BuilderComposition): string | null {
  if (diff.changedFields.length === 0) return null;
  const parts: string[] = [];
  if (diff.toolsAdded.length > 0) parts.push(`tools now available: +${diff.toolsAdded.join(", +")}`);
  if (diff.toolsRemoved.length > 0) parts.push(`tools removed: -${diff.toolsRemoved.join(", -")} (calls to them will fail)`);
  const otherFields = diff.changedFields.filter((field) => field !== "tools");
  if (otherFields.length > 0) parts.push(`updated blocks: ${otherFields.join(", ")}`);
  const toolList = after.tools.length > 0 ? after.tools.join(", ") : "none (tool system disabled)";
  parts.push(`current tool list: ${toolList}`);
  return `The agent composition was hot-swapped by the user. ${parts.join("; ")}.`;
}

/** Notice for a tool-free composition: the model must not attempt tool calls. */
export function buildNoToolsNotice(): string {
  return "No tools are bound to this session: the tool system is disabled. Answer directly from your own knowledge; tool calls are unavailable.";
}
