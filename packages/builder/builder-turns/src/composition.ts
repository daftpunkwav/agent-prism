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
  apiFormatSatisfies,
  requiredApiFormat,
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
  /**
   * Endpoint api formats by id. A framework with a required protocol
   * (requiredApiFormat) fails closed when this map is absent or has no entry
   * for the resolved endpoint. Frameworks with no required protocol ignore it.
   */
  endpointApiFormats?: Readonly<Record<string, string>>;
  /** Provider default endpoint id; resolves the "" (endpoint default) pick for the format gate. */
  defaultEndpointId?: string;
  /**
   * Legal values per registered custom dimension. When provided, an unknown
   * dimension id or an illegal value rejects at configure time; a custom value
   * with no entry here would only fail later, at run assembly.
   */
  customDimensionValues?: Readonly<Record<string, readonly string[]>>;
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
    throw BuilderError.invalid(`Unknown endpoint block "${composition.endpoint_id}" (it may have been deleted, renamed, or disabled)`);
  }
  // Any framework that authenticates against the endpoint itself declares the
  // protocol it speaks (requiredApiFormat). The resolved endpoint is the
  // explicit pick, else the provider default. Checked after endpoint existence
  // so a stale id keeps its own clearer message. Missing format facts fail
  // closed for a constrained framework. Own-key lookup: ids are caller input,
  // an inherited Object.prototype member must not pass as a format.
  const requiredFormat = requiredApiFormat(composition.framework);
  if (requiredFormat !== "") {
    const resolvedId = composition.endpoint_id !== "" ? composition.endpoint_id : (index.defaultEndpointId ?? "");
    const formats = index.endpointApiFormats;
    const format =
      formats !== undefined && Object.hasOwn(formats, resolvedId) ? formats[resolvedId] : undefined;
    if (!apiFormatSatisfies(requiredFormat, format)) {
      throw BuilderError.invalid(
        `Framework "${composition.framework}" needs an endpoint with api_format "${requiredFormat}" (endpoint "${resolvedId}" speaks ${format ?? "an unknown format"})`,
      );
    }
  }
  if (index.customDimensionValues !== undefined) {
    for (const [dimensionId, value] of Object.entries(composition.custom)) {
      // Own-key lookup: the record is caller input whose keys are only bounded by
      // length, so "toString"/"constructor" reach here — an inherited
      // Object.prototype member would make the includes() below throw a TypeError
      // (a 500) for what is really an unknown block (422).
      const legal = Object.hasOwn(index.customDimensionValues, dimensionId)
        ? index.customDimensionValues[dimensionId]
        : undefined;
      if (legal === undefined) {
        throw BuilderError.invalid(`Unknown custom dimension block "${dimensionId}" (no registered package provides it)`);
      }
      if (!legal.includes(value)) {
        throw BuilderError.invalid(`Custom dimension "${dimensionId}" has unsupported value "${value}"`);
      }
    }
  }
}

/**
 * Maps a composition onto PipelineConfig. The toolset field only feeds display
 * banners and prompt profiles: the authoritative tool authorization travels via
 * the run's explicit tool names, so a custom subset maps to "full" as the widest
 * description base and the actual bound set is always narrower (fail-closed).
 *
 * `customDimensionDefaults` are the registered dimensions' effective defaults
 * (the declared one, else the first option): a dimension the author never touched
 * still runs under its own default, exactly like every builtin block (whose unset
 * value is the schema default). Without the fill, a block the palette shows as
 * selected would run as "not selected at all".
 */
export function compositionToPipelineConfig(
  composition: BuilderComposition,
  label: string,
  options: { thinkingCapable: boolean; customDimensionDefaults?: Readonly<Record<string, string>> },
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
    // Builder compositions select a level, not a token budget: 0 follows the
    // level mapping (and the endpoint budget pair when configured).
    thinking_budget: 0,
    thinking_max_tokens: 0,
    thinking_mode: "levels",
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
    history_mode: composition.history_mode,
    prompt_version: "v1.0.0",
    // Custom-dimension blocks ride straight into the run config; unknown ids are
    // rejected at configure time (validateComposition) and again at run assembly,
    // and an explicit choice always wins over the dimension's declared default.
    custom: { ...options.customDimensionDefaults, ...composition.custom },
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
  "history_mode",
  "approval_mode",
  "sandbox_mode",
  "custom",
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
    if (field === "custom") {
      if (sameRecord(before.custom, after.custom)) continue;
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

/** Key-order-insensitive equality for the custom-value record. */
function sameRecord(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
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
