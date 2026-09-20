/**
 * @file errors
 * @description Fail-closed errors for unknown prompt configuration ids.
 *
 * Responsibilities:
 * - Raise UnknownPromptConfigError for unknown prompt/reasoning/harness/context ids
 *
 * Columns must fail loudly, never silently fall back to a different strategy.
 */

/** Thrown when a pipeline config references an unregistered prompt-related id. */
export class UnknownPromptConfigError extends Error {
  readonly field: string;
  readonly value: string;

  constructor(field: string, value: string) {
    super(`Unknown ${field}: ${value}`);
    this.name = "UnknownPromptConfigError";
    this.field = field;
    this.value = value;
  }
}
