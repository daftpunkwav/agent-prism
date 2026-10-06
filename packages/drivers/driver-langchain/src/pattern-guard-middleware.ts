/**
 * @file pattern-guard-middleware
 * @description Rejects tool calls whose model-supplied pattern arguments are
 *              too complex for the micromatch/braces matcher.
 *
 * Responsibilities:
 * - Bound the length and brace-nesting depth of pattern args before they reach
 *   framework matchers (glob -> fast-glob -> micromatch -> braces; grep's glob
 *   filter -> micromatch)
 * - Reject violations with a ToolMessage so the model can retry with a simpler
 *   pattern instead of failing the run
 *
 * braces@3.0.3 caps input at 10,000 chars but has no nesting-depth guard
 * (GHSA-vfj7-8cjw-p6xm): deep patterns burn unbounded event-loop time inside
 * the synchronous tool call and can exhaust the call stack. Both bounds sit
 * orders of magnitude below any legitimate glob need; escaped braces are
 * counted too, which only makes the guard stricter.
 */

import { ToolMessage } from "@langchain/core/messages";
import { createMiddleware, type AgentMiddleware } from "langchain";

/** Max pattern length accepted from a model-controlled arg, in characters. */
export const PATTERN_GUARD_MAX_LENGTH = 1024;

/** Max brace-nesting depth accepted from a model-controlled arg. */
export const PATTERN_GUARD_MAX_DEPTH = 32;

/** Rejection reason for an over-complex pattern, or null when it is acceptable. */
export function patternGuardRejection(pattern: string): string | null {
  if (pattern.length > PATTERN_GUARD_MAX_LENGTH) {
    return `is ${pattern.length} chars (limit ${PATTERN_GUARD_MAX_LENGTH})`;
  }
  let depth = 0;
  let deepest = 0;
  for (const ch of pattern) {
    if (ch === "{") {
      depth += 1;
      if (depth > deepest) deepest = depth;
    } else if (ch === "}") {
      depth -= 1;
    }
  }
  if (deepest > PATTERN_GUARD_MAX_DEPTH) {
    return `nests braces ${deepest} deep (limit ${PATTERN_GUARD_MAX_DEPTH})`;
  }
  return null;
}

/** Guard spec: tool name -> the args carrying pattern strings that reach a matcher. */
export type PatternGuardSpec = Readonly<Record<string, readonly string[]>>;

/**
 * Middleware rejecting over-complex patterns in the spec'd tool args with a
 * ToolMessage (the model sees the reason and can retry); every other tool,
 * arg and value shape passes through untouched.
 */
export function createPatternGuardMiddleware(spec: PatternGuardSpec): AgentMiddleware {
  return createMiddleware({
    name: "patternGuard",
    wrapToolCall: async (request, handler) => {
      const call = request.toolCall;
      const toolName = String(call.name ?? "");
      const argNames = spec[toolName];
      if (argNames === undefined) return handler(request);
      const args = (call.args && typeof call.args === "object" ? call.args : {}) as Record<string, unknown>;
      for (const argName of argNames) {
        const value = args[argName];
        if (typeof value !== "string") continue;
        const reason = patternGuardRejection(value);
        if (reason !== null) {
          return new ToolMessage({
            content: `[pattern guard] ${toolName} arg "${argName}" ${reason}; simplify the pattern and retry`,
            tool_call_id: String(call.id ?? ""),
            name: toolName,
          });
        }
      }
      return handler(request);
    },
  });
}
