/**
 * @file errors
 * @description Application errors carrying HTTP semantics for transport mapping.
 *
 * Responsibilities:
 * - Define AppError with status code and safe client-facing message
 * - Format validation-issue messages for 422 responses
 * - Serve as the single error vocabulary between application use cases and routes
 *   (domain-specific errors such as builder BuilderError live in their own packages)
 */

/** Application error: carries HTTP semantics, mapped to responses by the transport layer. */
export class AppError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "AppError";
    this.status = status;
    this.detail = detail;
  }

  static badRequest(detail: string): AppError {
    return new AppError(400, detail);
  }

  static conflict(detail: string): AppError {
    return new AppError(409, detail);
  }

  static notFound(detail: string): AppError {
    return new AppError(404, detail);
  }

  /** Semantically invalid but well-formed input (matches the schema-validation status). */
  static unprocessable(detail: string): AppError {
    return new AppError(422, detail);
  }

  static internal(detail: string): AppError {
    return new AppError(500, detail);
  }
}

/** First validation issue message, with a stable fallback for empty issue lists. */
export function firstIssueMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Invalid request parameters";
}
