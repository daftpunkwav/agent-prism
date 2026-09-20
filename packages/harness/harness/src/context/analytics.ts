/**
 * @file context/analytics
 * @description Per-run context analytics seam threaded into the pipeline.
 *
 * Responsibilities:
 * - Carry the usage ledger and effectiveness log for one run
 * - Record post-preparation per-source token estimates (char proxy)
 * - Observe strategy applications (kept/dropped volume, ledger emission)
 *
 * Estimates are char-proxy (CHARS_PER_TOKEN), not provider-observed counts:
 * the pipeline runs before the model call, so observed usage arrives later via
 * the token tracker. Role → source mapping is message-granularity truth.
 */

import { EffectivenessLog, UsageLedger, renderEffectivenessReport, renderUsageReport, type StrategyName, type StrategyObservation, type TurnUsage } from "@agentprism/context-analytics";
import type { LlmMessage } from "@agentprism/contracts";

/** Analytics carriers for one run (both append-only, both optional to wire). */
export interface ContextAnalytics {
  usage: UsageLedger;
  effectiveness: EffectivenessLog;
}

/** Creates an empty analytics bundle for one run. */
export function createContextAnalytics(): ContextAnalytics {
  return { usage: new UsageLedger(), effectiveness: new EffectivenessLog() };
}

const STRATEGY_NAMES = new Set<StrategyName>([
  "sliding", "summary", "vector", "hybrid", "tool_tail", "token_budget", "budget", "checkpoint",
]);

/** Narrows a pipeline strategy id to the analytics union (same set as the pipeline). */
export function isStrategyName(value: string): value is StrategyName {
  return STRATEGY_NAMES.has(value as StrategyName);
}

/** Maps a prepared message role to its usage source (message-granularity truth). */
function sourceOf(message: LlmMessage): "system" | "tools" | "history" {
  if (message.role === "system") return "system";
  if (message.role === "tool") return "tools";
  return "history";
}

/**
 * Records one turn's per-source char-proxy token estimates over the prepared
 * messages (post-trim composition is what the model will actually receive).
 */
export function recordPreparedUsage(analytics: ContextAnalytics, messages: readonly LlmMessage[]): void {
  const tokens: TurnUsage["tokens"] = { system: 0, tools: 0, history: 0 };
  for (const message of messages) {
    tokens[sourceOf(message)] = (tokens[sourceOf(message)] ?? 0) + Math.ceil(messageTextLength(message) / 4);
  }
  analytics.usage.record({ turn: analytics.usage.size + 1, tokens });
}

function messageTextLength(message: LlmMessage): number {
  return message.content.length;
}

/**
 * Renders the run-bundle reports (usage + effectiveness) for arena/eval tails.
 * Pure formatting over the ledgers; empty bundles render one stable line each.
 */
export function summarizeAnalytics(analytics: ContextAnalytics): { usage: string; effectiveness: string } {
  return {
    usage: renderUsageReport(analytics.usage.aggregate()),
    effectiveness: renderEffectivenessReport(analytics.effectiveness.effectiveness()),
  };
}

/** Observes one strategy application from its input/output message lists. */
export function observeStrategy(
  analytics: ContextAnalytics,
  strategy: StrategyName,
  input: readonly LlmMessage[],
  output: readonly LlmMessage[],
  ledgerEmitted: boolean,
): void {
  const inputChars = input.reduce((sum, m) => sum + messageTextLength(m), 0);
  const outputChars = output.reduce((sum, m) => sum + messageTextLength(m), 0);
  const inputToolResults = input.filter((m) => m.role === "tool").length;
  const outputToolResults = output.filter((m) => m.role === "tool").length;
  const observation: StrategyObservation = {
    strategy,
    inputMessages: input.length,
    outputMessages: output.length,
    inputChars,
    outputChars,
    toolResultsDropped: Math.max(0, inputToolResults - outputToolResults),
    ledgerEmitted,
  };
  analytics.effectiveness.observe(observation);
}
