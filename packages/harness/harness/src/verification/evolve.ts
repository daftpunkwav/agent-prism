/**
 * @file evolve
 * @description Self-evolution step: proposes prompt additions after reflection.
 *
 * Responsibilities:
 * - Turn reflection output into concrete prompt additions
 *
 * Failures return empty additions with a logged warning, never a silent catch.
 */

import type { LlmAdapter } from "@agentprism/contracts";
import type { JudgeOptions } from "./judge.js";
import { detectInjection, sanitizeForJson } from "@agentprism/contracts";
import { evolveInstruction } from "../prompt/runtime-copy.js";
import { recordAdapterUsage } from "../usage.js";

/** Self-evolution: proposes prompt modifications. */
export async function proposeHarnessEdit(
  question: string,
  answer: string,
  reflection: string,
  currentPrompt: string,
  llm: LlmAdapter,
  options: JudgeOptions = {},
): Promise<Record<string, unknown>> {
  // Same gate as the judge: poisoned reflection must not become prompt additions.
  if (detectInjection(reflection)) {
    console.warn("[harness] Self-evolve input looks injected; proposing no additions");
    return { prompt_additions: [], reasoning: "Self-evolve input rejected" };
  }
  try {
    const response = await llm.invoke(
      [{ role: "user", content: evolveInstruction(question, currentPrompt, reflection) }],
      { signal: options.signal },
    );
    recordAdapterUsage(response.usage, options.tracker);
    const cleaned = sanitizeForJson(response.text);
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    console.warn(`[harness] Self-evolve failed (empty additions): ${error instanceof Error ? error.message : String(error)}`);
    return { prompt_additions: [], reasoning: "Self-evolve parse failed" };
  }
}
