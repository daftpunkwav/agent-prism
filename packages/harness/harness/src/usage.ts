/**
 * @file usage
 * @description LLM usage extraction from model-call results.
 *
 * Responsibilities:
 * - Extract token usage into the neutral shape
 * - Record invoke usage onto trackers (one implementation for judge/reflect/evolve)
 *
 * Single source shared by drivers' event translation and harness logic.
 */

import type { TokenTracker } from "@agentprism/telemetry";

interface UsageLike {
  input_tokens?: unknown;
  output_tokens?: unknown;
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Extracts usage from a model-call result (AIMessage / stream-event data); compatible
 * with usage_metadata / response_metadata.usage / token_usage and the
 * input_tokens|prompt_tokens dual naming. Returns null when no valid usage exists.
 * Knowledge of LangChain response shapes belongs in the LangChain-aware package
 * (harness), never in the metering package.
 */
export function extractLlmUsage(data: unknown): { inputTokens: number; outputTokens: number } | null {
  if (data === null || typeof data !== "object") return null;
  const source = data as Record<string, unknown>;

  let usage: UsageLike | undefined;
  const output = source.output;
  if (output !== null && typeof output === "object") {
    const outputRecord = output as Record<string, unknown>;
    const responseMetadata = outputRecord.response_metadata as Record<string, unknown> | undefined;
    usage = (outputRecord.usage_metadata ?? responseMetadata?.usage ?? outputRecord.token_usage) as
      | UsageLike
      | undefined;
  }
  usage ??= (source.usage_metadata ?? source.usage) as UsageLike | undefined;
  if (usage === null || typeof usage !== "object") return null;

  const inputTokens = readNumber(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = readNumber(usage.output_tokens ?? usage.completion_tokens);
  if (inputTokens === 0 && outputTokens === 0) return null;
  return { inputTokens, outputTokens };
}

/**
 * Records one non-streaming invoke's vendor usage payload onto the tracker.
 * Single implementation for the judge/reflect/evolve chain: wraps the payload so the
 * full shape matrix above applies (earlier per-file copies only knew two namings).
 * Non-positive or non-finite values are left to the tracker's own guards.
 */
export function recordAdapterUsage(
  usage: Record<string, unknown> | undefined,
  tracker: TokenTracker | undefined,
): void {
  if (tracker === undefined || usage === undefined) return;
  const extracted = extractLlmUsage({ usage_metadata: usage });
  if (extracted !== null) {
    tracker.addUsage(extracted);
  }
}
