/**
 * @file reflect
 * @description Failure reflection for the verification loop.
 *
 * Responsibilities:
 * - Turn a verification reason into an improvement strategy for the next attempt
 */

import type { LlmAdapter } from "@agentprism/contracts";
import type { JudgeOptions } from "./judge.js";
import { detectInjection, sanitizeForJson } from "@agentprism/contracts";
import { recordAdapterUsage } from "../usage.js";

/** Reflects on a failure reason and produces an improvement-strategy text. */
export async function reflectOnFailure(
  question: string,
  answer: string,
  verificationReason: string,
  llm: LlmAdapter,
  options: JudgeOptions = {},
): Promise<string> {
  // Same gate as the judge: a poisoned answer must not steer the retry strategy.
  if (detectInjection(answer)) {
    console.warn("[harness] Reflection input looks injected; keeping the default retry strategy");
    return "Keep trying";
  }
  try {
    const response = await llm.invoke(
      [
        {
          role: "user",
          content:
            `Output JSON: {"insight":"...","strategy":"..."}\n\n` +
            `Question: ${question}\n\nAnswer: ${answer.slice(0, 2000)}\n\nReason: ${verificationReason}`,
        },
      ],
      { signal: options.signal },
    );
    recordAdapterUsage(response.usage, options.tracker);
    const cleaned = sanitizeForJson(response.text);
    const result = JSON.parse(cleaned) as Record<string, unknown>;
    const strategy = typeof result.strategy === "string" ? result.strategy : undefined;
    const insight = typeof result.insight === "string" ? result.insight : undefined;
    return strategy ?? insight ?? "Keep trying";
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    console.warn(`[harness] Reflection failed (falling back to default strategy): ${error instanceof Error ? error.message : String(error)}`);
    return "Reflection parse failed; retry with the original strategy";
  }
}
