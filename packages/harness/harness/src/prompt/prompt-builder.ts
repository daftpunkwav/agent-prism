/**
 * @file prompt-builder
 * @description Prompt part construction via the builtin section registry.
 *
 * Responsibilities:
 * - Fold sections in fixed order: profile, context_hint, harness, reasoning; cwd appended last to user text
 * - Fail closed on unknown profile/reasoning/harness/context ids
 */

import type { ContextStrategy, HarnessLevel, PromptProfile, ReasoningMode } from "@agentprism/contracts";
import { formatUtcDate } from "@agentprism/context-time";
import { getBuiltinPromptSectionRegistry, BASE_SYSTEM, PROFILES } from "./builtin-sections.js";
import { UnknownPromptConfigError } from "./errors.js";

export { BASE_SYSTEM, PROFILES };
export type { PromptProfileSpec } from "./legacy-types.js";

export interface PromptInputs {
  question: string;
  profile: PromptProfile | string;
  reasoning: ReasoningMode | string;
  harness: HarnessLevel | string;
  context: ContextStrategy | string;
  cwd?: string;
  /** Wall-clock ms for the time line; absent keeps prompts timeless (tests, offline replays). */
  now?: number;
}

export interface PromptParts {
  system: string;
  user: string;
}

/**
 * Assembles system/user prompt text (excluding RAG retrieval).
 * Throws UnknownPromptConfigError when any dimension id is unregistered.
 */
export function buildPromptParts(inputs: PromptInputs): PromptParts {
  const registry = getBuiltinPromptSectionRegistry();
  // Validate each field against the registry before folding (clearer errors than a single resolve miss).
  const config = {
    prompt_profile: inputs.profile,
    reasoning: inputs.reasoning,
    harness: inputs.harness,
    context: inputs.context,
  } as import("@agentprism/contracts").PipelineConfig;

  // registry.resolve only throws UnknownPromptConfigError; no mapping needed, let it propagate.
  const sections = registry.resolve(config);

  let system = "";
  let user = "";
  const sectionContext = {
    config,
    workspaceCwd: inputs.cwd ?? "",
    question: inputs.question,
  };

  for (const section of sections) {
    const contribution = section.contribute(sectionContext);
    if (contribution.system) system += contribution.system;
    if (contribution.user) user += contribution.user;
  }

  // Profile section owns the base user text (question + profile suffix). Cwd appends after.
  if (inputs.cwd && inputs.cwd !== "") {
    user += `\n\nCurrent working directory: ${inputs.cwd}`;
  }
  // Time grounding: UTC date line plus the machine's UTC offset — shell tools
  // print local time with no offset, so models otherwise misread it as UTC.
  // Formatting only (never a time source): the instant always arrives injected.
  // formatUtcDate is byte-identical here (the guard above excludes its unknown branch).
  if (inputs.now !== undefined && Number.isFinite(inputs.now) && inputs.now > 0) {
    user += `\n\nToday is ${formatUtcDate(inputs.now)}.`;
    user += ` Machine local timezone: ${formatUtcOffset(inputs.now)}; shell commands return local time.`;
  }

  if (system === "" || user.trim() === "") {
    throw new UnknownPromptConfigError("profile", String(inputs.profile));
  }
  return { system, user };
}

/** Renders the machine's UTC offset at the given instant (e.g. "UTC+08:00"). */
function formatUtcOffset(now: number): string {
  const offsetMinutes = -new Date(now).getTimezoneOffset();
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, "0");
  const minutes = String(abs % 60).padStart(2, "0");
  return `UTC${sign}${hours}:${minutes}`;
}
