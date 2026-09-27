/**
 * @file claude health tests
 * @description Locks the endpoint-health mapping for the Claude CLI column.
 *
 * Responsibilities:
 * - Pin that the CLI's provider-side signals report failures
 * - Pin that success and the CLI's own caps do not
 * - Pin that unrelated messages report nothing (no guessing from unknown shapes)
 */

import { describe, expect, it } from "vitest";
import { classifyClaudeHealth } from "../src/health.js";

describe("classifyClaudeHealth", () => {
  it("reports an API retry as a failed model call, with its status when known", () => {
    const withStatus = classifyClaudeHealth({ type: "system", subtype: "api_retry", errorStatus: 429 });
    expect(withStatus).toMatchObject({ ok: false });
    expect(String((withStatus as { error: Error }).error.message)).toContain("429");

    // A connection error has no HTTP response at all.
    const noResponse = classifyClaudeHealth({ type: "system", subtype: "api_retry", errorStatus: null });
    expect(noResponse).toMatchObject({ ok: false });
    expect(String((noResponse as { error: Error }).error.message)).toContain("no response");
  });

  it("reports a rejected rate limit and ignores the advisory states", () => {
    expect(classifyClaudeHealth({ type: "rate_limit_event", rateLimitStatus: "rejected" })).toMatchObject({ ok: false });
    expect(classifyClaudeHealth({ type: "rate_limit_event", rateLimitStatus: "allowed_warning" })).toBeNull();
    expect(classifyClaudeHealth({ type: "rate_limit_event", rateLimitStatus: "allowed" })).toBeNull();
  });

  it("reports a successful result as healthy", () => {
    expect(classifyClaudeHealth({ type: "result", subtype: "success" })).toEqual({ ok: true });
    // `isError` wins even when the subtype claims success.
    expect(classifyClaudeHealth({ type: "result", subtype: "success", isError: true })).toMatchObject({ ok: false });
  });

  it("reports an execution failure but not the CLI's own caps", () => {
    expect(classifyClaudeHealth({ type: "result", subtype: "error_during_execution" })).toMatchObject({ ok: false });
    // Turn/budget caps are this column's own limits: the endpoint did nothing wrong.
    expect(classifyClaudeHealth({ type: "result", subtype: "error_max_turns" })).toBeNull();
    expect(classifyClaudeHealth({ type: "result", subtype: "error_max_budget_usd" })).toBeNull();
    expect(classifyClaudeHealth({ type: "result", subtype: "error_max_structured_output_retries" })).toBeNull();
  });

  it("stays silent on messages that say nothing about endpoint health", () => {
    expect(classifyClaudeHealth({ type: "assistant" })).toBeNull();
    expect(classifyClaudeHealth({ type: "user" })).toBeNull();
    expect(classifyClaudeHealth({ type: "system", subtype: "init" })).toBeNull();
    expect(classifyClaudeHealth({})).toBeNull();
    expect(classifyClaudeHealth({ type: "stream_event" })).toBeNull();
  });
});
