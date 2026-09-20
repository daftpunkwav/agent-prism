/**
 * @file context/budget-strategy
 * @description "budget" context strategy backed by the context-budget allocator.
 *
 * Responsibilities:
 * - Measure per-source demand (history/tools) over non-pinned messages
 * - Allocate the token budget through priority weights and spend in order
 * - Drop lowest-priority oldest messages first until each source fits
 * - Render the allocation ledger so the model sees exactly what was cut
 *
 * Systems stay pinned (never budgeted); tool results are one source, user and
 * assistant turns another. Newest messages survive per source; allocation is
 * priority-ordered with cascade, deficits are loud via the rendered ledger.
 */

import { allocateBudget, renderBudgetLedger, type BudgetSourceName, type SourceDemand } from "@agentprism/context-budget";
import type { LlmMessage } from "@agentprism/contracts";
import { CHARS_PER_TOKEN, estimateMessageTokens } from "./message-text.js";

/** Default context budget in estimated tokens (matches token_budget's char budget scale). */
export const BUDGET_STRATEGY_TOKENS = 6_000;

function sourceOf(message: LlmMessage): Extract<BudgetSourceName, "tools" | "history"> {
  return message.role === "tool" ? "tools" : "history";
}

/**
 * Fits messages into a per-source token allocation. Returns the kept messages
 * (newest within each source) plus whether the ledger was emitted.
 */
export function applySourceBudget(
  rest: readonly LlmMessage[],
  options: { budgetTokens?: number; charsPerToken?: number } = {},
): { messages: LlmMessage[]; ledgerEmitted: boolean } {
  const budget = options.budgetTokens ?? BUDGET_STRATEGY_TOKENS;
  const divisor = options.charsPerToken ?? CHARS_PER_TOKEN;
  const demand: SourceDemand = { history: 0, tools: 0 };
  for (const message of rest) {
    const source = sourceOf(message);
    demand[source] = (demand[source] ?? 0) + estimateMessageTokens(message, divisor);
  }
  const result = allocateBudget(budget, demand);
  const remaining: Record<"tools" | "history", number> = {
    tools: result.allowances.find((a) => a.source === "tools")?.granted ?? 0,
    history: result.allowances.find((a) => a.source === "history")?.granted ?? 0,
  };
  // Walk oldest → newest, keeping messages while their source still has
  // allowance: the newest turns survive, the oldest overflow drops first.
  const kept: LlmMessage[] = [];
  for (const message of rest) {
    const source = sourceOf(message);
    const cost = estimateMessageTokens(message, divisor);
    if (remaining[source] >= cost) {
      remaining[source] -= cost;
      kept.push(message);
    }
  }
  const ledger = renderBudgetLedger(result);
  const messages = ledger === "" ? kept : [...kept, { role: "system" as const, content: ledger }];
  return { messages, ledgerEmitted: ledger !== "" };
}
