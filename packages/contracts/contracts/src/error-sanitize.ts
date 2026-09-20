/**
 * @file error-sanitize
 * @description External-facing error sanitization with a safe-passthrough class.
 *
 * Responsibilities:
 * - Expose only the error type name to clients
 * - Pass through ConfigurationError messages verbatim (code-constructed, safe)
 *
 * Prevents leaking internal details or credentials. Error objects expose
 * only name (except ConfigurationError); string inputs pass through — callers
 * must not forward foreign strings.
 */

/**
 * An error whose message was authored by this codebase for user consumption
 * (e.g. missing API key). Safe to show externally, unlike foreign SDK errors.
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/** Sanitizes an error for external exposure: only the exception type name is revealed. */
export function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof ConfigurationError) return error.message;
  if (error instanceof Error) return error.name;
  if (typeof error === "string") return error;
  return "Error";
}
