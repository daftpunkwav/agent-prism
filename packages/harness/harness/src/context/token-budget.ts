/**
 * @file token-budget
 * @description Global character-budget context strategy with priority drops.
 *
 * Responsibilities:
 * - Fit the message list into a fixed character budget before every LLM call
 * - Drop by priority (old tool results first, reasoning text last) with a loud ledger
 *
 * Rationale: sliding and tool_tail bound message *counts*; a single huge tool
 * dump still blows the model context. token_budget bounds *chars*: leading
 * system prompts are pinned, the newest turns are always kept, and the middle
 * is sacrificed in priority order — stale tool outputs first, then old
 * assistant chatter, then old user turns. A `[Budget ledger]` system line
 * records exactly what was dropped so the model knows the transcript is lossy
 * and can re-read files instead of hallucinating their content.
 */

import type { LlmMessage } from "@agentprism/contracts";
import { messageText } from "./message-text.js";
import { stripUnpairedToolTurns } from "./pair-safety.js";

/** Default total character budget across the assembled messages. */
export const TOKEN_BUDGET_CHARS = 24_000;

/** Newest turns (plus pinned systems) never sacrificed, in message count. */
export const TOKEN_BUDGET_KEEP_TURNS = 6;

function chars(message: LlmMessage): number {
  return messageText(message).length;
}

/** Drop priority: higher drops first. Systems are never scored (pinned). */
function dropPriority(message: LlmMessage): number {
  if (message.role === "tool") return 3;
  if (message.role === "assistant") return 2;
  return 1;
}

export interface TokenBudgetOptions {
  budget?: number;
  keepTurns?: number;
}

/**
 * Fits messages into a character budget with priority drops.
 * Keeps leading systems + the newest keepTurns messages; drops middle messages
 * oldest-first by (priority, age) until the budget holds; appends a ledger line
 * when anything was dropped. Never mutates the input.
 */
export function applyTokenBudget(messages: LlmMessage[], options: TokenBudgetOptions = {}): LlmMessage[] {
  if (messages.length === 0) return [];
  const budget = options.budget ?? TOKEN_BUDGET_CHARS;
  const keepTurns = options.keepTurns ?? TOKEN_BUDGET_KEEP_TURNS;
  const systems: LlmMessage[] = [];
  const rest: LlmMessage[] = [];
  for (const message of messages) {
    if (message.role === "system" && rest.length === 0) systems.push(message);
    else rest.push(message);
  }
  const pinned = rest.slice(-keepTurns);
  const candidates = rest.slice(0, -keepTurns);
  const total = [...systems, ...rest].reduce((sum, message) => sum + chars(message), 0);
  if (total <= budget) return [...systems, ...rest];
  // Oldest-first within each priority tier: index asc, priority desc.
  const order = candidates
    .map((message, index) => ({ message, index, priority: dropPriority(message) }))
    .sort((a, b) => b.priority - a.priority || a.index - b.index);
  const dropped = new Set<number>();
  let current = total;
  for (const entry of order) {
    if (current <= budget) break;
    // Never strand a leading tool result whose assistant turn survives: dropping
    // is oldest-first, so a tool message is only dropped with (or before) the
    // assistant turn that requested it in the same tier sweep.
    dropped.add(entry.index);
    current -= chars(entry.message);
  }
  const kept = candidates.filter((_, index) => !dropped.has(index));
  const droppedCount = dropped.size;
  const holds = current <= budget;
  const ledger: LlmMessage =
    holds
      ? {
          role: "system",
          content:
            `[Budget ledger] dropped ${droppedCount} older message(s) to hold a ${budget}-char budget ` +
            `(tool results first, reasoning last). Re-read files with read/grep instead of guessing their content.`,
        }
      : { role: "system", content: "[Budget ledger] transcript exceeds budget; no safe drop found, tail kept verbatim." };
  // Dropping can orphan a leading tool result whose assistant turn was cut;
  // providers reject orphan tool messages, so strip them after the ledger line.
  const tail = [...kept, ...pinned];
  let start = 0;
  while (start < tail.length && tail[start]?.role === "tool") start += 1;
  // The mirror orphan (a kept assistant whose tool results were cut) is equally
  // rejected by providers; the pair-safety pass strips both directions so the
  // trimmed transcript stays lossy-but-valid instead of failing the call.
  return stripUnpairedToolTurns([...systems, ledger, ...tail.slice(start)]);
}
