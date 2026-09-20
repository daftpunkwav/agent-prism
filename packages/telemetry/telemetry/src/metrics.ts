/**
 * @file metrics
 * @description Hard-metric aggregation for a single column run.
 *
 * Responsibilities:
 * - Assemble pre-aggregated counts plus TokenTracker into PipelineMetrics
 *
 * Event shape construction belongs to contracts (completeEvent, tokenUpdateEvent).
 */

import type { PipelineMetrics, TokenStats } from "@agentprism/contracts";
import { TokenTracker } from "./token.js";

/** Aggregates a single column run's hard metrics. */
export function buildMetrics(
  tracker: TokenTracker,
  options: { success: boolean; durationMs: number; toolCalls: number; steps: number },
): PipelineMetrics {
  const stats = tracker.asDict();
  // Duration comes from clock subtraction: a skewed/fake clock yields NaN or negatives,
  // and Math.round(NaN) would serialize as null downstream. Clamp to a sane range.
  const durationMs = Number.isFinite(options.durationMs) ? Math.max(0, Math.round(options.durationMs)) : 0;
  return {
    success: options.success,
    duration_ms: durationMs,
    input_tokens: stats.input_tokens,
    output_tokens: stats.output_tokens,
    total_tokens: stats.total_tokens,
    tool_calls: options.toolCalls,
    steps: options.steps,
    context_window: stats.context_window,
    max_input_tokens: stats.max_input_tokens,
    max_output_tokens: stats.max_output_tokens,
    context_usage_pct: stats.context_usage_pct,
    input_usage_pct: stats.input_usage_pct,
  };
}
