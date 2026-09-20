/**
 * @file tokenEstimate
 * @description Display-grade token estimation for the prompt-size demo.
 *
 * Responsibilities:
 * - Estimate prompt tokens with rough heuristics (not metering grade)
 * - Hold the sample system/user demo text
 */

/** Rough estimate: CJK ≈ 1.5 chars per token, non-CJK ≈ 4 chars per token (display heuristic, not a metering standard). */
export function estimatePromptTokens(system: string, user: string): number {
  const total = system + user;
  if (!total) return 0;
  // CJK Unified Ideographs U+4E00–U+9FFF (escaped so source stays ASCII).
  const cjk = (total.match(/[\u4e00-\u9fff]/g) || []).length;
  const nonCjk = total.length - cjk;
  return Math.ceil(cjk / 1.5 + nonCjk / 4);
}

/** Sample prompt for estimation (unrelated to real run prompts; illustrative size only). */
export const SAMPLE_SYSTEM =
  "You are an experimental Agent in the Arena lab, completing tasks in ReAct mode. Available tools: get_current_time (current time), calculate (simple math). Keep answers concise and accurate. When a tool is needed, state why before calling it.";
export const SAMPLE_USER = "Q: What time is it? → Thought: Need current time → Action: get_current_time";
