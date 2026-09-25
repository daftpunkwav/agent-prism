/**
 * @file structured-finalize
 * @description Schema-constrained final-answer normalization for the structured prompt profile.
 *
 * Responsibilities:
 * - Restate the raw final answer as schema-valid JSON through one constrained invoke
 * - Validate required keys and canonicalize the payload
 * - Record the finalize call's usage onto the run's token tracker
 *
 * Fail-open by design: adapter errors and invalid payloads return null so the
 * caller keeps the raw answer. The constraint maps to native wire support
 * (OpenAI response_format / Anthropic forced tool choice); endpoints with
 * neither degrade to prompt-only adherence, which validation still filters.
 */

import { FINAL_ANSWER_RESPONSE_FORMAT, parseStructuredFinalAnswer } from "@agentprism/contracts";
import type { AgentExecutionContext } from "./execution-context.js";
import { FINALIZE_SYSTEM, finalizeRestateRequest } from "./prompt/runtime-copy.js";
import { recordAdapterUsage } from "./usage.js";

/**
 * Normalizes one final answer into the structured schema. Returns the canonical
 * JSON string, or null when the raw answer is empty, the constrained call
 * fails, or the payload misses a required key.
 */
export async function finalizeStructuredAnswer(
  context: AgentExecutionContext,
  rawAnswer: string,
): Promise<string | null> {
  const trimmed = rawAnswer.trim();
  if (trimmed === "") return null;
  try {
    const response = await context.llm.invoke(
      [
        { role: "system", content: FINALIZE_SYSTEM },
        { role: "user", content: finalizeRestateRequest(trimmed) },
      ],
      { signal: context.signal, responseFormat: FINAL_ANSWER_RESPONSE_FORMAT },
    );
    // Same accounting contract as judge/reflect/evolve: the finalize is a real
    // LLM call, so its usage must reach the run's token tracker.
    recordAdapterUsage(response.usage, context.tracker);
    return parseStructuredFinalAnswer(response.text);
  } catch (error) {
    // Unsupported wire constraint or transient failure: the raw answer stands.
    console.warn("[structured-finalize] constrained call failed; keeping raw answer:", error);
    return null;
  }
}
