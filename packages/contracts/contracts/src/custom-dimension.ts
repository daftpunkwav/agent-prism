/**
 * @file custom-dimension
 * @description Port for custom comparison dimensions contributed by subpackages.
 *
 * Responsibilities:
 * - Define the CustomDimension descriptor and its hook slots
 * - Define the synthetic baseline field key used for custom values
 *
 * A custom dimension is one package under `packages/custom/<name>`: it declares
 * the values it can take and how a value takes effect. Registered at the
 * composition root, it becomes an Arena comparison axis, a Builder block, and a
 * pinnable baseline field without any frontend change. Hooks are pure message /
 * prompt / budget shaping over framework-neutral types: no vendor SDK, no IO,
 * and no ambient clock (a dimension must behave identically in every column).
 */

import type { ContextTuning } from "./context-tuning.js";
import type { LlmMessage } from "./llm-message.js";
import type { MemoryRecallResult } from "./memory-port.js";

/** Prefix of the synthetic baseline field name that carries a custom value (`custom.<id>`). */
export const CUSTOM_FIELD_PREFIX = "custom.";

/** Max length of a custom dimension id (also its Builder block suffix). */
export const CUSTOM_DIMENSION_ID_MAX = 64;

/**
 * Max length of a custom dimension option value. Every wire record that carries
 * configured values (`PipelineConfig.custom`, `BaselineOverrides.custom`,
 * `BuilderComposition.custom`) bounds values to this, so a descriptor declaring a
 * longer one could be selected but never persisted.
 */
export const CUSTOM_DIMENSION_VALUE_MAX = 200;

/** Accepted id grammar: lowercase snake_case, so it is URL/CLI/JSON-safe as-is. */
export const CUSTOM_DIMENSION_ID_RE = /^[a-z][a-z0-9_]{0,63}$/;

/** Synthetic baseline field name for one custom dimension ("custom.<id>"). */
export function customFieldKey(id: string): string {
  return `${CUSTOM_FIELD_PREFIX}${id}`;
}

/** Reads the dimension id back out of a synthetic field name ("" when not one). */
export function customFieldDimension(field: string): string {
  return field.startsWith(CUSTOM_FIELD_PREFIX) ? field.slice(CUSTOM_FIELD_PREFIX.length) : "";
}

/** One selectable value of a custom dimension. */
export interface CustomDimensionOption {
  value: string;
  label: string;
  description?: string;
}

/** Memory lines mounted into the system prompt (episodic/semantic caps). */
export interface MemoryBlockLimits {
  episodic: number;
  semantic: number;
}

/** Read-only context handed to a hook alongside the selected value. */
export interface CustomDimensionContext {
  question: string;
  /** The run's config, including this dimension's own value. */
  custom: Readonly<Record<string, string>>;
}

/** Message list handed to the `messages` hook, with its read-only context. */
export interface CustomMessagesInput {
  messages: readonly LlmMessage[];
  context: CustomDimensionContext;
}

/** Prompt halves handed to the `prompt` hook (system is the leading system turn). */
export interface CustomPromptInput {
  system: string;
  user: string;
  context: CustomDimensionContext;
}

/** Memory state handed to the `memory` hook (recall result plus the render caps). */
export interface CustomMemoryInput {
  recall: MemoryRecallResult | undefined;
  limits: MemoryBlockLimits;
  context: CustomDimensionContext;
}

/**
 * Hook slots a custom dimension may implement. Each slot maps to an existing
 * seam in the run pipeline; a dimension that implements none is a no-op (its
 * value then differs per column only through the prompt tag).
 */
export interface CustomDimensionHooks {
  /**
   * Per-run context budget overrides (e.g. the summary digest cap). Applied
   * before the context strategy runs, so the value can size its own budget.
   * Reach: every driver that applies the shared context pipeline.
   */
  contextTuning?(value: string, base: ContextTuning): Partial<ContextTuning> | undefined;
  /**
   * Reshapes the model-visible message list: runs after the context strategy and
   * before the pair-safety pass, sanitize, and tool grounding, so a hook that
   * drops tool results still yields a provider-valid transcript. Returning the
   * input unchanged is a no-op.
   * Reach: every driver that applies the shared context pipeline.
   */
  messages?(input: CustomMessagesInput, value: string): readonly LlmMessage[];
  /**
   * Reshapes the system/user prompt text (append, replace, strip). Returning
   * undefined keeps both halves unchanged.
   * Reach: every driver (the prompt assembly is shared).
   */
  prompt?(input: CustomPromptInput, value: string): { system?: string; user?: string } | undefined;
  /**
   * Reshapes the recalled memory before it is rendered: the recall result, the
   * render caps, or both (dropping entries needs the result; injecting all of
   * them also needs the caps, which are otherwise fixed).
   * Reach: every driver (memory is mounted during prompt assembly).
   */
  memory?(input: CustomMemoryInput, value: string): { recall?: MemoryRecallResult; limits?: MemoryBlockLimits } | undefined;
}

/**
 * One custom comparison dimension. `id` becomes the Arena dimension id and the
 * Builder block id `custom:<id>`; `options` are its selectable values.
 */
export interface CustomDimension {
  readonly id: string;
  /** English canonical label (product locales may overlay it in the web i18n catalogs). */
  readonly label: string;
  /** One-line purpose shown on the Arena dimension card. */
  readonly subtitle?: string;
  readonly options: readonly CustomDimensionOption[];
  /** Default value; must be one of `options` (defaults to the first option). */
  readonly default?: string;
  /** System-prompt tag for columns using this dimension (builtin context-hint style). */
  readonly promptHint?: string;
  readonly hooks?: CustomDimensionHooks;
}
