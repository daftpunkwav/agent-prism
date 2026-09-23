/**
 * @file history-render
 * @description Cross-turn history rendering at the execution boundary.
 *
 * Responsibilities:
 * - Render replayed history entries per the column's history_mode
 * - Append captured tool activity to assistant entries (summary or full)
 *
 * Capture always stores the full superset (tool_rounds); this boundary trims
 * per mode right before the run starts, so every driver (and the fork/subagent
 * paths that inherit parent history) sees the same render with zero driver
 * changes. minimal output is byte-identical to the legacy bare Q/A transcript.
 */

import type { ChatMessage, HistoryMode } from "@agentprism/contracts";
import { renderToolActivity } from "@agentprism/contracts";

/**
 * Renders one history list per the history mode.
 * Assistant entries carrying tool_rounds get the mode's `[Tool activity]`
 * appendix; user entries and round-less entries pass through untouched
 * (minimal is therefore an identity transform on legacy shapes).
 */
export function renderHistoryForMode(history: ChatMessage[], mode: HistoryMode): ChatMessage[] {
  if (mode === "minimal") return history;
  return history.map((message) => {
    const rounds = message.role === "assistant" ? message.tool_rounds : undefined;
    const appendix = renderToolActivity(rounds, mode);
    if (appendix === "") return message;
    return { ...message, content: `${message.content}${appendix}` };
  });
}
