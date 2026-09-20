/**
 * @file prompt-section
 * @description Port for contributing system/user prompt fragments.
 *
 * Responsibilities:
 * - Define the section interface and its registry
 *
 * Profiles, reasoning suffixes, and discipline text register as independent
 * sections; assembly only folds them.
 */

import type { PipelineConfig } from "./arena.js";

/** Inputs available when a prompt section contributes text. */
export interface PromptSectionContext {
  config: PipelineConfig;
  workspaceCwd: string;
  question: string;
}

/** Fragments appended to the system and/or user message. */
export interface PromptContribution {
  system?: string;
  user?: string;
}

/**
 * One prompt contributor. Implementations must be pure with respect to IO;
 * unknown config ids are rejected by the registry before contribute is called.
 */
export interface PromptSection {
  readonly id: string;
  contribute(context: PromptSectionContext): PromptContribution;
}

/** Registry of prompt sections resolved for one column run. */
export interface PromptSectionRegistry {
  register(section: PromptSection): void;
  /** Resolves sections for the given config; throws on unknown profile/reasoning. */
  resolve(config: PipelineConfig): PromptSection[];
}
