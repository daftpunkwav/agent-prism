/**
 * @file bridge-prompt
 * @description Arena prompt assembly for the Python framework bridges (autogen, crewai).
 *
 * Responsibilities:
 * - Merge the Arena system prompt into the transcript the child framework sends
 * - Splice the column's prior-turn history in after the leading system turn
 *
 * The bridge keeps the framework's own role instructions: the first system turn the
 * child sends is that role copy, and the Arena prompt is prepended to it (the same
 * order the Deep Agents column uses). Without this the bridge columns would run on
 * the framework's role copy alone — dropping the prompt profile, the reasoning text,
 * the tool roster, the recalled memories and every policy note that the in-process
 * columns all receive.
 */

import type { ChatTurnMessage, LlmMessage } from "@agentprism/contracts";
import { buildHistoryMessages } from "@agentprism/harness";

/**
 * Prepends the Arena system prompt to the child's leading system turn, or adds a
 * system turn when the child sent none. One merged turn (never two) keeps the
 * provider-visible message list identical to the in-process columns'.
 */
export function withArenaSystem(messages: LlmMessage[], system: string): LlmMessage[] {
  const first = messages[0];
  if (first !== undefined && first.role === "system") {
    return [{ role: "system", content: `${system}\n\n${first.content}` }, ...messages.slice(1)];
  }
  return [{ role: "system", content: system }, ...messages];
}

/**
 * Splices the column's prior-turn history in after the leading system turn — the
 * position `buildInitialMessages` uses — so the framework reads the history as the
 * conversation that precedes its task. Sent for the first completion only: the
 * framework's own transcript carries every later turn.
 */
export function withHistory(messages: LlmMessage[], history?: ChatTurnMessage[]): LlmMessage[] {
  const turns = buildHistoryMessages(history);
  if (turns.length === 0) return messages;
  const insertAt = messages[0]?.role === "system" ? 1 : 0;
  return [...messages.slice(0, insertAt), ...turns, ...messages.slice(insertAt)];
}
