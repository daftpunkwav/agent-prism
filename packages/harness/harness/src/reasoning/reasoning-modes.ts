/**
 * @file reasoning-modes
 * @description Reasoning-mode specs: metadata plus fixed prompt suffixes.
 *
 * Responsibilities:
 * - Declare per-mode display metadata and suffix injections
 * - Fail closed on unknown modes
 */

import type { ReasoningMode } from "@agentprism/contracts";
import { REASONING_MODE_META, type ReasoningModeMeta } from "@agentprism/contracts";
import { REASONING_SUFFIXES } from "../prompt/builtin-sections.js";
import { UnknownPromptConfigError } from "../prompt/errors.js";

/** Reasoning-mode spec: display metadata + fixed system/user suffixes. */
export interface ReasoningModeSpec extends ReasoningModeMeta {
  systemSuffix: string;
  userSuffix: string;
}

export const REASONING_MODES: readonly ReasoningModeSpec[] = REASONING_MODE_META.map((meta) => ({
  ...meta,
  ...REASONING_SUFFIXES[meta.mode],
}));

function specOf(mode: ReasoningMode | string): ReasoningModeSpec {
  const found = REASONING_MODES.find((spec) => spec.mode === mode);
  if (found === undefined) {
    throw new UnknownPromptConfigError("reasoning", String(mode));
  }
  return found;
}

/** Appends the reasoning-mode suffixes to system/user. */
export function applyReasoningMode(
  baseSystem: string,
  baseUser: string,
  mode: ReasoningMode | string,
): { system: string; user: string } {
  const spec = specOf(mode);
  return { system: baseSystem + spec.systemSuffix, user: baseUser + spec.userSuffix };
}

/** Reasoning-mode description (for the opening banner). */
export function getReasoningDescription(mode: ReasoningMode | string): string {
  return specOf(mode).description;
}
