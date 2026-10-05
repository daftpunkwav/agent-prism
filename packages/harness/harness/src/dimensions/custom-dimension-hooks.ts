/**
 * @file custom-dimension-hooks
 * @description Applies active custom dimensions at the run's four hook seams.
 *
 * Responsibilities:
 * - Fold every active dimension's hooks in registration order
 * - Keep each hook at its real seam: budgets, messages, prompt, memory
 *
 * Hooks are pure shaping over framework-neutral values. The `messages` hook runs
 * after the context strategy and before the pair-safety pass, so a dimension that
 * drops tool results still yields a provider-valid transcript; `prompt` and
 * `memory` run during prompt assembly, which every driver shares.
 */

import type {
  CustomDimensionContext,
  ContextTuning,
  LlmMessage,
  MemoryRecallResult,
} from "@agentprism/contracts";
import type { MemoryBlockLimits } from "@agentprism/contracts";
import type { ActiveCustomDimension } from "./custom-dimensions.js";

/** Read-only per-run facts every hook may consult. */
export interface CustomDimensionRun {
  question: string;
  custom: Readonly<Record<string, string>>;
}

function contextOf(run: CustomDimensionRun): CustomDimensionContext {
  return { question: run.question, custom: run.custom };
}

/**
 * Folds the `contextTuning` hooks over the operator's base budgets. Returns the
 * base object unchanged when no dimension contributes (no needless copy: the
 * base may be the shared operator tuning bag, which must never be mutated).
 */
export function applyCustomContextTuning(
  activeDimensions: readonly ActiveCustomDimension[],
  base: ContextTuning,
  // Signature stays aligned with the other three folds; the contextTuning hook
  // contract intentionally carries no run context (it folds budgets only).
  _run: CustomDimensionRun,
): ContextTuning {
  let current = base;
  for (const { dimension, value } of activeDimensions) {
    const hook = dimension.hooks?.contextTuning;
    if (hook === undefined) continue;
    const patch = hook(value, current);
    if (patch === undefined) continue;
    // Copy on first contribution: the operator bag stays untouched (columns run
    // concurrently and must not see each other's budgets).
    current = { ...current, ...patch };
  }
  return current;
}

/**
 * Folds the `messages` hooks over the model-visible list, in registration order.
 * The result feeds the shared pair-safety pass, so hooks may delete freely.
 * `observe` receives each dimension's own before/after lists, so per-dimension
 * effectiveness rows measure that dimension rather than the whole fold.
 */
export function applyCustomMessages(
  activeDimensions: readonly ActiveCustomDimension[],
  messages: readonly LlmMessage[],
  run: CustomDimensionRun,
  observe?: (dimensionId: string, before: readonly LlmMessage[], after: readonly LlmMessage[]) => void,
): readonly LlmMessage[] {
  let current = messages;
  for (const { dimension, value } of activeDimensions) {
    const hook = dimension.hooks?.messages;
    if (hook === undefined) continue;
    const next = hook({ messages: current, context: contextOf(run) }, value);
    observe?.(dimension.id, current, next);
    current = next;
  }
  return current;
}

/** Folds the `prompt` hooks over the system/user halves. */
export function applyCustomPrompt(
  activeDimensions: readonly ActiveCustomDimension[],
  parts: { system: string; user: string },
  run: CustomDimensionRun,
): { system: string; user: string } {
  let system = parts.system;
  let user = parts.user;
  for (const { dimension, value } of activeDimensions) {
    const hook = dimension.hooks?.prompt;
    if (hook === undefined) continue;
    const patch = hook({ system, user, context: contextOf(run) }, value);
    if (patch === undefined) continue;
    if (patch.system !== undefined) system = patch.system;
    if (patch.user !== undefined) user = patch.user;
  }
  return { system, user };
}

/** Folds the `memory` hooks over the recall result and the prompt render caps. */
export function applyCustomMemory(
  activeDimensions: readonly ActiveCustomDimension[],
  recall: MemoryRecallResult | undefined,
  limits: MemoryBlockLimits,
  run: CustomDimensionRun,
): { recall: MemoryRecallResult | undefined; limits: MemoryBlockLimits } {
  let currentRecall = recall;
  // Copy once before handing the bag out: callers pass the shared module default
  // (MEMORY_BLOCK_LIMITS), which concurrent columns reuse — a hook that mutates
  // its input instead of returning a patch must not repin every later run.
  let currentLimits: MemoryBlockLimits = { ...limits };
  for (const { dimension, value } of activeDimensions) {
    const hook = dimension.hooks?.memory;
    if (hook === undefined) continue;
    const patch = hook({ recall: currentRecall, limits: currentLimits, context: contextOf(run) }, value);
    if (patch === undefined) continue;
    if (patch.recall !== undefined) currentRecall = patch.recall;
    if (patch.limits !== undefined) currentLimits = patch.limits;
  }
  return { recall: currentRecall, limits: currentLimits };
}

/**
 * Prompt-hint lines of the active dimensions, in registration order. Rendered as
 * one system-prompt suffix so a column's prompt states which custom values are in
 * force (the same visible-tag convention the builtin context hints use).
 */
export function customPromptHint(activeDimensions: readonly ActiveCustomDimension[]): string {
  const lines: string[] = [];
  for (const { dimension, value } of activeDimensions) {
    const hint = dimension.promptHint;
    if (hint === undefined || hint === "") continue;
    lines.push(hint.replaceAll("{value}", value));
  }
  return lines.join("");
}
