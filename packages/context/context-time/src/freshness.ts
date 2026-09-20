/**
 * @file context-time/freshness
 * @description Per-source staleness budgets for retrieved context.
 *
 * Responsibilities:
 * - Declare freshness budgets per context source (retrieval/snippets/tools)
 * - Classify cached payloads as fresh/stale/expired against an injected now
 * - Render staleness markers for prompt grounding
 *
 * A snippet retrieved three turns ago may describe a file the agent has since
 * rewritten: freshness budgets turn "retrieved at turn N" into an explicit
 * verdict instead of silent trust. Sources that mutate fast (tool output)
 * get tight budgets; stable ones (system prompts) are exempt.
 */

export type FreshnessSource = "retrieval" | "snippets" | "tool_output" | "mentions";

/** Default staleness budgets in turns (Infinity = exempt). */
export const FRESHNESS_BUDGETS_TURNS: Record<FreshnessSource, number> = {
  retrieval: 3,
  snippets: 3,
  tool_output: 1,
  mentions: 5,
};

export type FreshnessVerdict = "fresh" | "stale" | "expired";

/**
 * Classifies a payload cached at `cachedTurn` for `currentTurn`.
 * Fresh: within budget. Stale: within 2x budget (usable with caution).
 * Expired: beyond (re-fetch). Turn numbers are 1-based; reversed turns fail
 * closed to expired (a clock/ledger bug must never read as fresh).
 */
export function freshnessVerdict(
  source: FreshnessSource,
  cachedTurn: number,
  currentTurn: number,
  budgets: Record<FreshnessSource, number> = FRESHNESS_BUDGETS_TURNS,
): FreshnessVerdict {
  const budget = budgets[source] ?? 1;
  if (!Number.isFinite(cachedTurn) || !Number.isFinite(currentTurn)) return "expired";
  const age = currentTurn - cachedTurn;
  if (age < 0) return "expired";
  if (age <= budget) return "fresh";
  if (age <= budget * 2) return "stale";
  return "expired";
}

/** Renders a staleness marker for prompt grounding (empty when fresh). */
export function freshnessMarker(source: FreshnessSource, verdict: FreshnessVerdict): string {
  if (verdict === "fresh") return "";
  if (verdict === "stale") return `[Staleness: ${source} may be outdated; re-read before trusting]`;
  return `[Staleness: ${source} expired; re-fetch before trusting]`;
}
