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

import { EffectivenessLog, UsageLedger, renderEffectivenessReport, renderUsageReport, type StrategyId, type StrategyObservation, type TurnUsage } from "@agentprism/context-analytics";
import type { LlmMessage } from "@agentprism/contracts";
import { estimateMessageTokens, messageText } from "./message-text.js";

/** Analytics carriers for one run (both append-only, both optional to wire). */
export interface ContextAnalytics {
  usage: UsageLedger;
  effectiveness: EffectivenessLog;
}

/** Creates an empty analytics bundle for one run. */
export function createContextAnalytics(): ContextAnalytics {
  return { usage: new UsageLedger(), effectiveness: new EffectivenessLog() };
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
 * `charsPerToken` is the run's divisor, so these numbers stay comparable with the
 * budget arithmetic that produced the composition.
 */
export function recordPreparedUsage(
  analytics: ContextAnalytics,
  messages: readonly LlmMessage[],
  charsPerToken?: number,
): void {
  const tokens: TurnUsage["tokens"] = { system: 0, tools: 0, history: 0 };
  for (const message of messages) {
    const source = sourceOf(message);
    tokens[source] = (tokens[source] ?? 0) + estimateMessageTokens(message, charsPerToken);
  }
  analytics.usage.record({ turn: analytics.usage.size + 1, tokens });
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

/**
 * Observes one strategy application from its input/output message lists. The id
 * is opaque: builtin strategies and registered custom dimensions are observed
 * the same way, so both appear in the run's effectiveness rows.
 */
export function observeStrategy(
  analytics: ContextAnalytics,
  strategy: StrategyId,
  input: readonly LlmMessage[],
  output: readonly LlmMessage[],
  ledgerEmitted: boolean,
): void {
  const inputChars = input.reduce((sum, m) => sum + messageText(m).length, 0);
  const outputChars = output.reduce((sum, m) => sum + messageText(m).length, 0);
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
