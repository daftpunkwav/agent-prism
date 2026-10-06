/**
 * @file pattern-guard middleware tests
 * @description Pins the guard bounds, the ToolMessage rejection path and pass-through.
 *
 * Responsibilities:
 * - Pin length and depth bounds at the exact boundary values
 * - Pin the rejection ToolMessage shape and that the matcher handler never runs
 * - Pin pass-through for unlisted tools, unlisted args and non-string values
 */

import { describe, expect, it, vi } from "vitest";
import { ToolMessage } from "@langchain/core/messages";
import type { AgentMiddleware } from "langchain";
import {
  PATTERN_GUARD_MAX_DEPTH,
  PATTERN_GUARD_MAX_LENGTH,
  createPatternGuardMiddleware,
  patternGuardRejection,
} from "../src/pattern-guard-middleware.js";

type WrapToolCall = NonNullable<AgentMiddleware["wrapToolCall"]>;
type ToolCallRequest = Parameters<WrapToolCall>[0];
type Handler = Parameters<WrapToolCall>[1];

const spec = { glob: ["pattern"], grep: ["glob"] } as const;

/** A brace-nesting pattern `depth` levels deep, well under the length bound. */
function nested(depth: number): string {
  return "{a,".repeat(depth) + "b" + "}".repeat(depth);
}

function request(name: string, args: Record<string, unknown>): ToolCallRequest {
  return { toolCall: { id: "call_1", name, args } } as unknown as ToolCallRequest;
}

/** Handler returning one stable ToolMessage, with its call counter exposed. */
function ranHandler(): { handler: Handler; matched: ToolMessage; calls: () => number } {
  const matched = new ToolMessage({ content: "matched", tool_call_id: "call_1", name: "glob" });
  const handler = vi.fn(async () => matched);
  return { handler: handler as unknown as Handler, matched, calls: () => handler.mock.calls.length };
}

describe("patternGuardRejection", () => {
  it("accepts ordinary globs", () => {
    expect(patternGuardRejection("**/*.{ts,tsx}")).toBeNull();
  });

  it("bounds length at exactly 1024 chars", () => {
    expect(patternGuardRejection("a".repeat(PATTERN_GUARD_MAX_LENGTH))).toBeNull();
    expect(patternGuardRejection("a".repeat(PATTERN_GUARD_MAX_LENGTH + 1))).toContain("1025 chars");
  });

  it("bounds brace nesting at exactly 32 deep", () => {
    expect(patternGuardRejection(nested(PATTERN_GUARD_MAX_DEPTH))).toBeNull();
    expect(patternGuardRejection(nested(PATTERN_GUARD_MAX_DEPTH + 1))).toContain("nests braces 33 deep");
  });

  it("ignores stray closers", () => {
    expect(patternGuardRejection("}}}***")).toBeNull();
  });
});

describe("createPatternGuardMiddleware", () => {
  it("rejects an over-complex glob pattern with a ToolMessage and skips the handler", async () => {
    const middleware = createPatternGuardMiddleware(spec);
    const { handler, calls } = ranHandler();
    const result = await middleware.wrapToolCall!(request("glob", { pattern: nested(64) }), handler);
    expect(result).toBeInstanceOf(ToolMessage);
    expect(String((result as ToolMessage).content)).toContain('[pattern guard] glob arg "pattern"');
    expect(String((result as ToolMessage).content)).toContain("nests braces 64 deep");
    expect(calls()).toBe(0);
  });

  it("guards the grep tool's glob filter under its own arg name", async () => {
    const middleware = createPatternGuardMiddleware(spec);
    const { handler, calls } = ranHandler();
    const result = await middleware.wrapToolCall!(request("grep", { pattern: "needle", glob: nested(64) }), handler);
    expect(String((result as ToolMessage).content)).toContain('grep arg "glob"');
    expect(calls()).toBe(0);
  });

  it("passes boundary and ordinary patterns through to the matcher", async () => {
    const middleware = createPatternGuardMiddleware(spec);
    const { handler, matched, calls } = ranHandler();
    expect(
      await middleware.wrapToolCall!(request("glob", { pattern: nested(PATTERN_GUARD_MAX_DEPTH) }), handler),
    ).toBe(matched);
    expect(await middleware.wrapToolCall!(request("glob", { pattern: "**/*.{ts,tsx}" }), handler)).toBe(matched);
    expect(calls()).toBe(2);
  });

  it("leaves tools, args and value shapes outside the spec untouched", async () => {
    const middleware = createPatternGuardMiddleware(spec);
    const { handler, calls } = ranHandler();
    // grep's literal search arg is not the matcher's pattern input.
    await middleware.wrapToolCall!(request("grep", { pattern: nested(64) }), handler);
    // Framework read tools carry no guarded args.
    await middleware.wrapToolCall!(request("read_file", { path: nested(64) }), handler);
    // Non-string values cannot carry brace nesting.
    await middleware.wrapToolCall!(request("glob", { pattern: 42 }), handler);
    expect(calls()).toBe(3);
  });
});
