/**
 * @file history-render
 * @description Cross-turn history rendering at the execution boundary.
 *
 * Responsibilities:
 * - Render replayed history per the column's history_mode into chat turns
 * - tool_summary: append a deterministic per-call digest to past answers
 * - full: expand captured tool rounds into structured assistant/tool turns
 *
 * Capture always stores the full superset (tool_rounds); this boundary shapes
 * the replay per mode right before the run starts, so every driver (and the
 * fork/subagent paths that inherit parent history) sees the same render with
 * zero driver changes. minimal keeps bare Q/A pairs; the stored wire form
 * (user/assistant + optional tool_rounds) never carries the expansion, so the
 * wire's strict user/assistant alternation validation is untouched.
 */

import type { ChatMessage, ChatTurnMessage, HistoryMode, LlmToolCall } from "@agentprism/contracts";
import { renderToolActivity } from "@agentprism/contracts";

/** Maps one stored bare entry into the rendered turn shape. */
function bareTurn(message: ChatMessage): ChatTurnMessage {
  return message.role === "assistant"
    ? { role: "assistant", content: message.content }
    : { role: "user", content: message.content };
}

/**
 * Renders one history list per the history mode.
 * - minimal: bare Q/A pairs, no tool trace.
 * - tool_summary: the answer keeps a `[Tool activity]` digest appended.
 * - full: each round-carrying answer expands chronologically into
 *   assistant(tool_calls) → tool results → assistant(answer), so the model sees
 *   the previous turn's tool calls and their results as first-class messages.
 */
export function renderHistoryForMode(history: ChatMessage[], mode: HistoryMode): ChatTurnMessage[] {
  const out: ChatTurnMessage[] = [];
  for (let index = 0; index < history.length; index += 1) {
    const message = history[index] as ChatMessage;
    const rounds = message.role === "assistant" ? message.tool_rounds : undefined;
    if (rounds === undefined || rounds.length === 0) {
      out.push(bareTurn(message));
      continue;
    }
    if (mode === "full") {
      // Chronological reconstruction: the answer came after the tools ran, so the
      // tool-calling shell precedes the results and the answer closes the turn.
      const calls: LlmToolCall[] = rounds.map((round, i) => ({
        id: `hist_${index}_${i}`,
        name: round.tool,
        args: round.args,
      }));
      out.push({ role: "assistant", content: "", toolCalls: calls });
      rounds.forEach((round, i) => {
        out.push({ role: "tool", content: round.result, toolCallId: calls[i]?.id ?? "", name: round.tool });
      });
      out.push({ role: "assistant", content: message.content });
      continue;
    }
    const appendix = renderToolActivity(rounds, mode);
    out.push({ role: "assistant", content: appendix === "" ? message.content : `${message.content}${appendix}` });
  }
  return out;
}
