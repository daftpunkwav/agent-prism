/**
 * @file judge
 * @description LLM verification judge deciding whether an answer passes.
 *
 * Responsibilities:
 * - Judge the answer against the task with an LLM call
 *
 * Parse failures and injection hits fail closed (passed=false).
 */

import type { LlmAdapter } from "@agentprism/contracts";
import type { TokenTracker } from "@agentprism/telemetry";
import { detectInjection, sanitizeForJson } from "@agentprism/contracts";
import { judgeInstruction } from "../prompt/runtime-copy.js";
import { recordAdapterUsage } from "../usage.js";

export interface JudgeOptions {
  signal?: AbortSignal;
  tracker?: TokenTracker;
}

/** LLM judges whether an answer passes; parse failures count as failing. */
export async function verifyResult(
  question: string,
  answer: string,
  toolCalls: number,
  llm: LlmAdapter,
  options: JudgeOptions = {},
): Promise<{ passed: boolean; reason: string }> {
  if (detectInjection(answer)) {
    return { passed: false, reason: "Possible prompt injection detected" };
  }
  try {
    const response = await llm.invoke(
      [{ role: "user", content: judgeInstruction(question, answer, toolCalls) }],
      { signal: options.signal },
    );
    recordAdapterUsage(response.usage, options.tracker);
    const cleaned = sanitizeForJson(response.text);
    const result = JSON.parse(cleaned) as Record<string, unknown>;
    return {
      passed: result.passed === true,
      reason: typeof result.reason === "string" ? result.reason : "Unable to parse verification result",
    };
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    console.warn(`[harness] Verification failed (treated as not passed): ${error instanceof Error ? error.message : String(error)}`);
    return { passed: false, reason: "Verification parse failed; treated as not passed" };
  }
}
