/**
 * @file legacy-types
 * @description Re-export of the prompt profile shape for legacy import paths.
 *
 * Responsibilities:
 * - Keep PromptProfileSpec importable from its historical module
 */

export interface PromptProfileSpec {
  system: string;
  userSuffix: string;
}
