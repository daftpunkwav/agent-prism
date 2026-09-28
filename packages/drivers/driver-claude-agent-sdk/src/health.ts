/**
 * @file claude-health
 * @description Maps Claude Code CLI stream messages onto endpoint-health outcomes.
 *
 * Responsibilities:
 * - Classify the CLI's own provider-failure signals (api_retry, rate limits)
 * - Classify the run's terminal result (success / the CLI's own caps / execution failure)
 * - Stay silent about everything else, so an unknown message type cannot report health
 *
 * The Claude column owns its model transport (the CLI subprocess makes the calls), so
 * it cannot use the callbacks the other columns attach to their chat model. These are
 * the only two provider-side signals the CLI reports, and they are precise:
 * `system/api_retry` is emitted per failed-and-retried API request (error_status null
 * for connection errors), and the terminal `result` reports whether the calls that ran
 * completed. The CLI's own limits (turn/budget caps) are column behavior, not endpoint
 * faults, so they are deliberately not reported.
 */

import type { ModelCallOutcome } from "@agentprism/contracts";

/**
 * Message fields this classifier reads: a hand-rolled structural subset of the CLI's
 * stream messages. `reportHealth` in claude-driver.ts maps their snake_case fields
 * onto these camelCase names.
 */
export interface ClaudeHealthMessage {
  type?: unknown;
  subtype?: unknown;
  errorStatus?: unknown;
  isError?: unknown;
  rateLimitStatus?: unknown;
}

/** The CLI's own caps: the run stopped on purpose, the endpoint did nothing wrong. */
const BUDGET_SUBTYPES = new Set([
  "error_max_turns",
  "error_max_budget_usd",
  "error_max_structured_output_retries",
]);

/**
 * One health outcome for a CLI message, or null when the message says nothing about
 * endpoint health. A returned `{ok:false}` is a model call that failed.
 */
export function classifyClaudeHealth(message: ClaudeHealthMessage): ModelCallOutcome | null {
  if (message.type === "system" && message.subtype === "api_retry") {
    // A model call failed and will be retried; the CLI reports the HTTP status (null
    // when the request never got a response, e.g. a timeout).
    const status = typeof message.errorStatus === "number" ? ` (status ${message.errorStatus})` : " (no response)";
    return { ok: false, error: new Error(`Claude API request failed${status}`) };
  }
  if (message.type === "rate_limit_event" && message.rateLimitStatus === "rejected") {
    return { ok: false, error: new Error("Claude API rate limit rejected the request") };
  }
  if (message.type !== "result") return null;
  const failed = message.subtype !== "success" || message.isError === true;
  if (!failed) return { ok: true };
  if (typeof message.subtype === "string" && BUDGET_SUBTYPES.has(message.subtype)) return null;
  return { ok: false, error: new Error(`Claude run failed (${String(message.subtype)})`) };
}
