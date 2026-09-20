/**
 * @file errors
 * @description Builder domain errors carrying HTTP semantics.
 *
 * Responsibilities:
 * - Define BuilderError with a status code and a safe client-facing detail
 * - Provide named constructors for the builder's failure vocabulary
 *
 * The transport layer maps these onto HTTP responses; no other layer inspects them.
 */

/** Domain error of the builder service: status-aware, message is client-safe. */
export class BuilderError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "BuilderError";
    this.status = status;
    this.detail = detail;
  }

  static notFound(detail: string): BuilderError {
    return new BuilderError(404, detail);
  }

  static conflict(detail: string): BuilderError {
    return new BuilderError(409, detail);
  }

  static invalid(detail: string): BuilderError {
    return new BuilderError(422, detail);
  }
}
